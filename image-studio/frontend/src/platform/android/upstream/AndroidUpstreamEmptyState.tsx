import { RadioTower } from "lucide-react";

export function AndroidUpstreamEmptyState() {
  return (
    <section className="android-upstream-empty">
      <div className="android-upstream-empty-icon">
        <RadioTower className="h-5 w-5" />
      </div>
      <div className="android-upstream-empty-copy">
        <h4>添加第一个上游</h4>
        <p>
          请选择上方的 FHL 常规 或 APIMart 异步入口。
          一键配置只会写入推荐参数，API Key 需要你在配置表单里手动粘贴。
        </p>
      </div>
    </section>
  );
}
