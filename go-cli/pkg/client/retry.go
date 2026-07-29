package client

import (
	"encoding/json"
	"fmt"
	"regexp"
	"strings"
)

var retryableMarkers = []string{
	"error code 524",
	"524: a timeout occurred",
	"error code 504",
	"gateway time-out",
	"rate_limit_exceeded",
	"upstream_error",
	"service temporarily unavailable",
	"origin_gateway_timeout",
	"no available account",
	"无可用账号",
	"请稍后重试",
}

// IsRetryable mirrors Python is_retryable_response.
func IsRetryable(raw string) bool {
	text := strings.TrimSpace(raw)
	lower := strings.ToLower(text)
	if upstreamErr, ok := upstreamErrorFromRaw(text); ok &&
		strings.EqualFold(strings.TrimSpace(upstreamErr.Type), "invalid_request_error") &&
		strings.Contains(strings.ToLower(upstreamErr.Message), "mask is not supported") {
		return false
	}
	for _, m := range retryableMarkers {
		if strings.Contains(lower, m) {
			return true
		}
	}

	var data map[string]any
	if err := json.Unmarshal([]byte(text), &data); err != nil {
		return false
	}
	if v, ok := data["retryable"].(bool); ok && v {
		return true
	}
	if status, ok := data["status"].(float64); ok {
		switch int(status) {
		case 502, 503, 504, 524:
			return true
		}
	}
	if errObj, ok := data["error"].(map[string]any); ok {
		message, _ := errObj["message"].(string)
		errType, _ := errObj["type"].(string)
		lowerMessage := strings.ToLower(message)
		if strings.Contains(lowerMessage, "temporarily unavailable") ||
			strings.Contains(lowerMessage, "no available account") ||
			strings.Contains(message, "无可用账号") ||
			strings.Contains(message, "请稍后重试") ||
			strings.Contains(message, "稍后重试") {
			return true
		}
		switch strings.ToLower(errType) {
		case "api_error", "server_error":
			return true
		case "upstream_error":
			if message == "" || strings.Contains(message, "重试") || strings.Contains(lowerMessage, "retry") || strings.Contains(lowerMessage, "temporarily") {
				return true
			}
			return true
		}
	}
	return false
}

// DescribeProblem returns a human-readable Chinese explanation of an
// upstream failure body. Mirrors Python describe_response_problem.
func DescribeProblem(raw string) string {
	text := strings.TrimSpace(raw)
	if text == "" {
		return "接口返回为空。"
	}
	lower := strings.ToLower(text)
	if strings.Contains(lower, "error code 524") || strings.Contains(lower, "524: a timeout occurred") {
		return "Cloudflare 524:源站在超时时间内没有返回有效响应。"
	}
	if strings.Contains(lower, "error code 504") || strings.Contains(lower, "gateway time-out") {
		return "Cloudflare 504:源站网关超时。"
	}

	var data map[string]any
	if err := json.Unmarshal([]byte(text), &data); err == nil && data != nil {
		var statusLabel string
		if status, ok := data["status"].(float64); ok {
			statusLabel = fmt.Sprintf("%d", int(status))
		}
		if name, ok := data["error_name"].(string); ok && (name == "origin_gateway_timeout" || name == "timeout") {
			if statusLabel == "" {
				statusLabel = name
			}
		}
		if statusLabel != "" {
			return fmt.Sprintf("接口返回 %s:上游服务超时。", statusLabel)
		}
		if errObj, ok := data["error"].(map[string]any); ok {
			if msg, ok := errObj["message"].(string); ok && msg != "" {
				return fmt.Sprintf("接口返回错误:%s", msg)
			}
			b, _ := json.Marshal(errObj)
			return fmt.Sprintf("接口返回错误:%s", string(b))
		}
		if msg, ok := data["message"].(string); ok && msg != "" {
			return fmt.Sprintf("接口返回消息:%s", msg)
		}
	}

	for ev := range IterEvents(raw) {
		// 优先抓 bare error 事件(里面 code/message 最齐全),其次 response.failed 里的嵌套 error
		if errObj, ok := ev["error"].(map[string]any); ok {
			return describeAPIError(errObj)
		}
		if resp, ok := ev["response"].(map[string]any); ok {
			if errObj, ok := resp["error"].(map[string]any); ok {
				return describeAPIError(errObj)
			}
		}
	}

	return "接口已返回内容,但没有发现 image_generation_call.result。"
}

// reqIDRe 匹配 OpenAI 错误消息里的 request ID(UUID 形如 4906b7e4-767b-4d95-8008-cf07260f546d)。
// 这个 ID 用户做 appeal 时要附给 help.openai.com。
var reqIDRe = regexp.MustCompile(`request ID[:\s]+([A-Za-z0-9-]{20,})`)

func extractRequestID(s string) string {
	m := reqIDRe.FindStringSubmatch(s)
	if len(m) >= 2 {
		return m[1]
	}
	return ""
}

// describeAPIError 把 SSE / JSON 错误对象翻成中文友好提示。
// 识别常见的 OpenAI 错误码;不在白名单的回退到「code + message」清单格式,
// 不再 dump 原始 JSON(原 JSON 转储留在 raw 日志里,前端用查看日志按钮访问)。
func describeAPIError(e map[string]any) string {
	code, _ := e["code"].(string)
	msg, _ := e["message"].(string)
	typ, _ := e["type"].(string)
	reqID := extractRequestID(msg)

	switch strings.ToLower(code) {
	case "moderation_blocked":
		out := "🚫 上游内容审核拦截 · 生成被拒\n\n" +
			"OpenAI 安全系统(image safety classifier)否决了这次请求,这是平台硬策略,与客户端配置 / 网络无关。\n\n" +
			"常见触发原因:\n" +
			"  • 真实人物 / 公众人物姓名(肖像)\n" +
			"  • 版权角色(Marvel / Disney / 任天堂 / 动漫 / 游戏 IP)\n" +
			"  • 注册商标 + 吉祥物联名 + 品牌衍生\n" +
			"  • 暴力 / 武器 / 血腥 / NSFW\n" +
			"  • 政治敏感人物 / 符号 / 国旗变体\n\n" +
			"换个不指名 IP 的措辞重发即可。客户端不会自动重试 —— 避免在确定会拒的请求上无谓消耗 token。"
		if reqID != "" {
			out += "\n\n如认为是误判,可联系 help.openai.com 附 request ID = " + reqID
		}
		return out

	case "content_policy_violation":
		// Images API 路径的对应错误
		out := "🚫 上游内容政策拦截 (content_policy_violation)\n\nImages API 拒绝了这次生成,通常是版权角色 / 商标 / 敏感内容触发。换个不指名 IP 的 prompt 重发。"
		if reqID != "" {
			out += "\n\nrequest ID = " + reqID
		}
		return out

	case "rate_limit_exceeded":
		return "⏱ 上游限速 (rate_limit_exceeded)\n\n" + msg + "\n\n稍等几秒再试,或在「上游配置」换一个有更高额度的分组。"

	case "insufficient_quota", "billing_hard_limit_reached":
		return "💳 上游账户额度不足\n\n" + msg + "\n\n请到中转站后台确认套餐 / 余额状态。"

	case "invalid_api_key", "incorrect_api_key", "invalid_request_error":
		if strings.Contains(strings.ToLower(msg), "api key") || strings.Contains(strings.ToLower(code), "api_key") {
			return "🔑 API Key 无效或已过期\n\n" + msg + "\n\n打开「上游配置」检查并替换 API Key。"
		}
		// invalid_request_error 也可能是别的请求字段问题,继续走 fallback

	case "model_not_found":
		return "🤷 上游找不到指定模型\n\n" + msg + "\n\n打开「上游配置」检查图像模型 ID,确认你的 key 所在分组拥有此模型权限。"
	}

	// Fallback:不再 dump 原始 JSON(日志文件里有),只把 message + code + type 拼成单行
	var parts []string
	if msg != "" {
		parts = append(parts, msg)
	}
	tail := []string{}
	if code != "" {
		tail = append(tail, "code: "+code)
	}
	if typ != "" {
		tail = append(tail, "type: "+typ)
	}
	if len(tail) > 0 {
		parts = append(parts, "("+strings.Join(tail, ", ")+")")
	}
	if len(parts) > 0 {
		return "接口返回错误:" + strings.Join(parts, " ")
	}
	// 最后的兜底,如果连 message / code / type 都没有,才回到 JSON dump
	b, _ := json.Marshal(e)
	return "接口返回错误:" + string(b)
}
