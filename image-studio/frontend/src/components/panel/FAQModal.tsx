import { Modal } from "../common/Modal";
import { OpenExternalURL } from "../../platform/runtime/host";
import { openExternalURLForPlatform } from "../../platform/android/bridge";
import {
  closeTabShortcutLabel,
  copyShortcutLabel,
  fullscreenShortcutLabel,
  newTabShortcutLabel,
  pasteShortcutLabel,
  platformOutputRootLabel,
  redoShortcutLabel,
  submitShortcutLabel,
  undoShortcutLabel,
} from "../../platform";

export function FAQModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} title="常见问题" width={520}>
      <div className="faq">
        <details open>
          <summary>Responses API 与 Images API 怎么选?</summary>
          <p>
            本应用支持两种上游接口形态,在「🔧 上游配置」里切换:
          </p>
          <ul>
            <li>
              <strong>Responses API · CF 超时推荐</strong>:POST <code>/v1/responses</code>,通过模型内置的
              <code> image_generation </code> 工具触发生图,SSE 流式接收。
              <strong>能防 Cloudflare 524/504 超时</strong>(图像推理常常超过 100 秒)。
              <br />
              <strong>Key 要绑「拥有 gpt-5.5 模型的分组」</strong>(中转站后台通常叫「余额分组」或「套餐分组」),
              不要选 image-2 分组。
            </li>
            <li>
              <strong>Images API · 兼容广</strong>:标准 OpenAI <code>/v1/images/generations</code>(文生图)+
              <code>/v1/images/edits</code>(图生图,multipart 上传)。一次性 JSON 响应,无 SSE 保活,
              长推理上 CF 超时风险更高。几乎所有 OpenAI 兼容中转站都开了这两个端点。
              <br />
              <strong>Key 可使用标准的 image-2 / image API 分组</strong>,不需要 gpt-5.5 权限。
            </li>
          </ul>
          <p>
            <strong>选哪个?</strong>看你 key 绑的是哪个分组。
            两边都有的话优先 Responses(SSE 更抗 524)。
          </p>
        </details>

        <details>
          <summary>支持哪些上游中转站?</summary>
          <p>
            <strong>不内置任何默认上游</strong>,首次启动会自动弹出「上游配置」窗口,
            填入你自己的 BASE_URL + API Key + 选择 API 形态(见上一条 FAQ)。
          </p>
          <p>
            <strong>Responses API 模式</strong>下:任何兼容 OpenAI Responses API 形态 + 提供
            <code> image_generation </code> 工具的中转站都行。
          </p>
          <p>
            <strong>Images API 模式</strong>下:任何提供 <code>/v1/images/generations</code> 和
            <code> /v1/images/edits </code>(或仅 generations,若只做文生图)的 OpenAI 兼容中转站都行。
          </p>
          <p>
            注意:只提供 <code>/v1/chat/completions</code> 的中转站<strong>两种模式都不兼容</strong>(本应用不发 chat 请求)。
          </p>
        </details>

        <details>
          <summary>能换其他文本 / 图像模型吗?</summary>
          <p>
            可以。在「🔧 上游配置」里填即可,不同 API 形态用到的字段不一样:
          </p>
          <ul>
            <li>
              <strong>Responses API</strong> 用<strong>两个</strong>模型 ID:
              <ul>
                <li><strong>文本模型 ID</strong>(默认 <code>gpt-5.5</code>):承担推理 + 调用 image_generation 工具</li>
                <li><strong>图像模型 ID</strong>(默认 <code>gpt-image-2</code>):工具实际用哪个图像模型出图</li>
              </ul>
            </li>
            <li>
              <strong>Images API</strong> 只用<strong>一个</strong>模型 ID:
              <ul>
                <li><strong>图像模型 ID</strong>(默认 <code>gpt-image-2</code>):直接传给 <code>/v1/images/generations</code> 的 <code>model</code> 字段。文本模型 ID 在此模式下不读。</li>
              </ul>
            </li>
          </ul>
        </details>

        <details>
          <summary>生成失败 / 504 / 524 怎么办?</summary>
          <p>
            上游网关超时(Cloudflare 504/524)在中转站上很常见。本应用<strong>自动重试 3 次,每次间隔 15 秒</strong>。
            如果三次都失败:
          </p>
          <ul>
            <li>检查 key 是否过期 / 余额是否充足 / 是否绑对了分组(见第一条)</li>
            <li>查看历史项右键「📄 查看 raw 响应」看上游具体返回了什么</li>
          </ul>
        </details>

        <details>
          <summary>蒙版 / 多参考图 / seed 上游会用吗?</summary>
          <p>
            这些字段是否发送,取决于当前 profile 里的「参数策略」。默认 `OpenAI 标准` 只发官方公开字段；切到 `兼容中转扩展` 才会额外发送 relay 常见扩展字段。
          </p>
          <ul>
            <li><strong>多参考图</strong>:作为多个 <code>input_image</code> 内容块发送,上游解释方式因模型而异</li>
            <li><strong>蒙版</strong>:Responses 模式按 OpenAI 官方 <code>input_image_mask</code> 发送；Images 模式按标准 multipart <code>mask</code> 文件发送</li>
            <li><strong>seed / negative prompt</strong>:属于 relay 常见扩展字段。只有在 `兼容中转扩展` 策略下才会附带发送，OpenAI 标准模式默认不发</li>
          </ul>
        </details>

        <details>
          <summary>数据存在哪里?会上传吗?</summary>
          <p>
            <strong>完全本地存储,不上传任何服务器</strong>(除了向上游 API 转发你的生成请求):
          </p>
          <ul>
            <li>API Key:系统安全存储(Keychain / Credential Manager / Secret Service)</li>
            <li>历史记录元数据:本地 IndexedDB 数据库</li>
            <li>生成的图片 PNG:<code>{platformOutputRootLabel()}/images/</code></li>
            <li>导入的源图:系统 config 目录下的 <code>image-studio/imports/</code>(内部 scratch,与输出目录解耦)</li>
            <li>原始上游响应:输出根目录的 <code>log/</code> 下(<code>sse-response-*.txt</code> 或 <code>images-response-*.json</code>,排错时用)</li>
          </ul>
        </details>

        <details>
          <summary>快捷键?</summary>
          <ul>
            <li><kbd>{submitShortcutLabel}</kbd> — 提交生成</li>
            <li><kbd>{newTabShortcutLabel}</kbd> / <kbd>{closeTabShortcutLabel}</kbd> — 新建 / 关闭标签</li>
            <li><kbd>{undoShortcutLabel}</kbd> / <kbd>{redoShortcutLabel}</kbd> — 撤销 / 重做</li>
            <li><kbd>{copyShortcutLabel}</kbd> / <kbd>{pasteShortcutLabel}</kbd> — 复制 / 粘贴图片</li>
            <li><kbd>1</kbd> / <kbd>2</kbd> / <kbd>3</kbd> — 拖动 / 蒙版 / 标注 工具</li>
            <li><kbd>空格</kbd> — 按住临时切到拖动</li>
            <li><kbd>F</kbd> — 重置视图;双击画板 — fit ↔ 100%</li>
            <li><kbd>{fullscreenShortcutLabel}</kbd> — 全屏</li>
            <li><kbd>[</kbd> / <kbd>]</kbd> — 笔刷大小</li>
            <li><kbd>Esc</kbd> — 取消生成 / 退出对比 / 关闭弹窗</li>
            <li><kbd>Delete</kbd> — 删除选中标注</li>
          </ul>
        </details>

        <details>
          <summary>反馈渠道?</summary>
          <p>
            <a
              style={{ color: "var(--accent)", cursor: "pointer", textDecoration: "underline" }}
              onClick={() => openExternalURLForPlatform("https://github.com/supart/fhl-image-studio/issues", OpenExternalURL).catch(() => undefined)}
            >GitHub Issues</a> · 项目 AGPLv3 协议开源
          </p>
        </details>
      </div>
    </Modal>
  );
}
