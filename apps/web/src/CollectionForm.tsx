import { useEffect, useRef, useState } from "react";
import { Camera, Clipboard, FileText, Upload, X } from "lucide-react";
import { api, entity } from "./api";
const accept =
  "image/jpeg,image/png,application/pdf,text/plain,text/csv,audio/webm";
const types = accept.split(",");
export function CollectionForm({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: () => void;
}) {
  const [mode, setMode] = useState("file");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState("");
  const picker = useRef<HTMLInputElement>(null),
    camera = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!file?.type.startsWith("image/")) {
      setPreview("");
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  function choose(files: File[]) {
    if (busy) return;
    if (files.length !== 1) {
      setError("每次保存一份原件，请逐份收集。");
      return;
    }
    const f = files[0];
    if (!types.includes(f.type)) {
      setError(
        "支持 JPG、PNG、PDF、TXT、CSV 和 WebM。手机照片请使用 JPG 或 PNG 格式。",
      );
      return;
    }
    if (!f.size || f.size > 25 * 1024 * 1024) {
      setError("文件不能为空，且不能超过 25MB。");
      return;
    }
    setFile(f);
    setMode("file");
    setError("");
  }
  return (
    <div className="overlay">
      <section
        className="modal collection-modal"
        onPaste={(e) => {
          const files = Array.from(e.clipboardData.files);
          if (files.length) {
            e.preventDefault();
            choose(files);
          }
        }}
      >
        <header>
          <h2>先收集资料</h2>
          <button
            className="icon"
            aria-label="关闭"
            disabled={busy}
            onClick={onClose}
          >
            <X />
          </button>
        </header>
        <p>
          名片、截图、需求文件或聊天原文，先存进资料箱，稍后整理。不必先填写客户档案。
        </p>
        <div className="actions">
          <button
            className={mode === "file" ? "" : "secondary"}
            aria-pressed={mode === "file"}
            onClick={() => setMode("file")}
          >
            <Upload size={17} />
            图片 / 文件
          </button>
          <button
            className={mode === "text" ? "" : "secondary"}
            aria-pressed={mode === "text"}
            onClick={() => setMode("text")}
          >
            <FileText size={17} />
            粘贴原文
          </button>
        </div>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setError("");
            setBusy(true);
            try {
              if (mode === "file") {
                if (!file) throw new Error("请先拍照、粘贴截图或选择文件。");
                const data = new FormData();
                data.append("file", file);
                const response = await fetch("/api/v1/files", {
                  method: "POST",
                  headers: { "X-Entity-Id": entity },
                  body: data,
                });
                const result = await response.json();
                if (!response.ok)
                  throw new Error(result.error?.message || "上传失败");
              } else {
                if (!text.trim()) throw new Error("请先粘贴或输入原文。");
                await api("sources", "POST", {
                  name: text.trim().slice(0, 40),
                  body: text,
                  kind: "document",
                });
              }
              onClose();
              onSaved();
            } catch (e: any) {
              setError("尚未保存成功：" + e.message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {mode === "file" ? (
            <>
              <input
                ref={picker}
                type="file"
                accept={accept}
                hidden
                aria-label="选择采集文件"
                onChange={(e) => {
                  if (e.target.files?.length)
                    choose(Array.from(e.target.files));
                  e.target.value = "";
                }}
              />
              <input
                ref={camera}
                type="file"
                accept="image/jpeg,image/png"
                capture="environment"
                hidden
                aria-label="拍摄资料"
                onChange={(e) => {
                  if (e.target.files?.length)
                    choose(Array.from(e.target.files));
                  e.target.value = "";
                }}
              />
              <div
                className="collection-drop"
                tabIndex={0}
                aria-label="截图粘贴与文件拖入区域"
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  choose(Array.from(e.dataTransfer.files));
                }}
              >
                <Clipboard size={28} />
                <b>在这里粘贴截图，或拖入文件</b>
                <small>电脑按 Ctrl + V；Mac 按 ⌘ + V</small>
                <div className="actions">
                  <button
                    type="button"
                    className="secondary"
                    disabled={busy}
                    onClick={() => camera.current?.click()}
                  >
                    <Camera size={17} />
                    手机拍照
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    disabled={busy}
                    onClick={() => picker.current?.click()}
                  >
                    选择图片或文件
                  </button>
                </div>
                <small>
                  每次一份，最大 25MB；支持 JPG / PNG / PDF / TXT / CSV / WebM
                </small>
              </div>
              {file && (
                <div className="collection-preview">
                  {preview && <img src={preview} alt="待保存资料预览" />}
                  <p>
                    {file.name} · {(file.size / 1024).toFixed(1)} KB · 尚未保存
                  </p>
                  <button
                    type="button"
                    className="text"
                    disabled={busy}
                    onClick={() => setFile(null)}
                  >
                    移除文件
                  </button>
                </div>
              )}
              <p className="draft-note">
                当前只保存原件，图片文字识别尚未接通。不会自动生成客户或判断联系许可。
              </p>
            </>
          ) : (
            <label>
              聊天记录 / 邮件 / 客户需求原文
              <textarea
                aria-label="采集原文"
                rows={8}
                maxLength={100000}
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="直接粘贴原文，不用先拆成多个字段。"
              />
            </label>
          )}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <footer>
            <small>提交成功才会保存到服务器；关闭前请保留原文件或原文。</small>
            <button disabled={busy}>
              {busy ? "正在保存…" : "保存到资料箱"}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}
