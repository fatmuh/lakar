// Dialog Export code (epic kode story 5, desain 09 "Export code" lK7Y5/tC8HF React + Tailwind, u7OIu/GlSzh React +
// CSS): target, opsi, daftar file, pratinjau berwarna, Copy file, Download .zip. Kode dihasilkan langsung di viewer
// dengan @lakar/codegen (AD-16/AD-17) dari dokumen terkini; glyph ikon dari GET /viewer/render-deps (katalog yang sama
// dengan daemon), jadi berkasnya identik dengan tool MCP `export_code`.
import { useEffect, useMemo, useState } from 'react';
import type { IconGlyph, LakarDocument } from '@lakar/schema';
import { api, errorText } from './api';
import { DEFAULT_SETTINGS, exportCode, fileMeta, fileRows, filesSummary, findStoredNode, formatBytes, highlight, nodeKindLabel, TARGET_LABEL, TOK_CLASS, zipName, type CodeExportSettings, type CodegenFile, type CodegenTarget } from './codeExport';
import { copyText } from './Connections';
import { download } from './ExportPopover';
import { Icon } from './icons';
import { Modal } from './NewFileDialog';
import { zipFiles } from './zip';
import type { CodegenWarning } from '@lakar/codegen';

/** Batas kunci render-deps per permintaan (RENDER_DEPS_MAX daemon). */
const DEPS_CHUNK = 256;

/** Glyph dari daemon; gagal (offline) → tanpa glyph, codegen menulis warning `icon-glyph-missing` (ekspor tetap jalan). */
async function fetchGlyphs(keys: string[]): Promise<IconGlyph[]> {
  const out: IconGlyph[] = [];
  try {
    for (let i = 0; i < keys.length; i += DEPS_CHUNK) out.push(...(await api.renderDeps({ fonts: [], icons: keys.slice(i, i + DEPS_CHUNK) })).icons);
  } catch {
    return [];
  }
  return out;
}

type State = { state: 'loading' } | { state: 'ok'; files: CodegenFile[]; warnings: CodegenWarning[] } | { state: 'error'; message: string };

const OPTIONS: { key: 'components' | 'tokens' | 'typescript'; title: string; sub: string }[] = [
  { key: 'components', title: 'Components as separate files', sub: 'Masters become their own component files' },
  { key: 'tokens', title: 'Include tokens file', sub: 'tokens.css with :root and [data-theme] modes' },
  { key: 'typescript', title: 'TypeScript', sub: 'Typed props for text, boolean and enum' },
];

export function CodeExportDialog({ doc, nodeId, initialTarget, onClose }: { doc: LakarDocument; nodeId: string; initialTarget?: CodegenTarget | undefined; onClose: () => void }) {
  const [settings, setSettings] = useState<CodeExportSettings>(() => (initialTarget ? { ...DEFAULT_SETTINGS, target: initialTarget } : DEFAULT_SETTINGS));
  const [result, setResult] = useState<State>({ state: 'loading' });
  const [active, setActive] = useState<string | undefined>(undefined);
  const [copied, setCopied] = useState<'file' | 'icon' | undefined>(undefined);
  const [note, setNote] = useState<string | undefined>(undefined);
  const node = findStoredNode(doc, nodeId);

  // Ekspor ulang tiap rev atau opsi berubah; file aktif dipertahankan bila masih ada (nama .tsx ↔ .jsx diikuti).
  useEffect(() => {
    let live = true;
    exportCode(doc, nodeId, settings, fetchGlyphs).then(
      (r) => {
        if (!live) return;
        setResult({ state: 'ok', files: r.files, warnings: r.warnings });
        setActive((a) => {
          const alt = a?.replace(/\.(tsx|jsx)$/, settings.typescript ? '.tsx' : '.jsx');
          return r.files.find((f) => f.path === alt)?.path ?? r.files[0]?.path;
        });
      },
      (e: unknown) => live && setResult({ state: 'error', message: errorText(e) }),
    );
    return () => {
      live = false;
    };
  }, [doc, nodeId, settings]);

  const files = result.state === 'ok' ? result.files : [];
  const file = files.find((f) => f.path === active) ?? files[0];
  const lines = useMemo(() => (file ? highlight(file.path, file.contents) : []), [file]);

  const flash = (what: 'file' | 'icon') => {
    setCopied(what);
    setTimeout(() => setCopied((c) => (c === what ? undefined : c)), 1500);
  };
  const copyFile = async (what: 'file' | 'icon') => {
    if (!file) return;
    try {
      await copyText(file.contents);
      flash(what);
    } catch {
      setNote('Clipboard is not available.');
    }
  };
  const downloadZip = () => {
    if (!files.length) return;
    const name = zipName(files, settings.target);
    download(new Blob([zipFiles(files)], { type: 'application/zip' }), name);
    setNote(`Download started: ${name}`);
  };
  const set = (patch: Partial<CodeExportSettings>) => {
    setNote(undefined);
    setSettings((s) => ({ ...s, ...patch }));
  };

  return (
    <Modal label="Export code" onClose={onClose} className="code-dialog">
      <header className="code-header">
        <Icon name="codeXml" size={16} />
        <div className="code-titles">
          <h2>Export code</h2>
          <span>
            {node ? `${node.name} · ${nodeKindLabel(node)}` : nodeId} · rev {doc.rev}
          </span>
        </div>
        <span className="code-spacer" />
        <button type="button" className="dp-icon-btn boxed" aria-label="Close" title="Close" onClick={onClose}>
          <Icon name="x" size={14} />
        </button>
      </header>
      <div className="code-body">
        <div className="code-options">
          <div className="code-field">
            <span className="field-label">Target</span>
            <div className="segmented code-target" role="radiogroup" aria-label="Target">
              {(['react-tailwind', 'react-css'] as CodegenTarget[]).map((t) => (
                <button key={t} type="button" role="radio" aria-checked={settings.target === t} className={`segment${settings.target === t ? ' active' : ''}`} onClick={() => set({ target: t })} data-autofocus={settings.target === t ? '' : undefined}>
                  <Icon name={t === 'react-tailwind' ? 'wind' : 'fileCode'} size={13} />
                  {TARGET_LABEL[t]}
                </button>
              ))}
            </div>
          </div>
          <div className="code-field">
            <span className="field-label">Options</span>
            {OPTIONS.map((o) => (
              <label key={o.key} className="code-option">
                <input type="checkbox" checked={settings[o.key]} onChange={(e) => set({ [o.key]: e.currentTarget.checked })} />
                <span className="code-check" aria-hidden="true">
                  <Icon name="check" size={11} />
                </span>
                <span className="code-option-text">
                  <span>{o.title}</span>
                  <small>{o.sub}</small>
                </span>
              </label>
            ))}
          </div>
          <div className="code-field code-files">
            <div className="code-files-head">
              <span className="field-label">Files</span>
              {files.length > 0 && <small>{filesSummary(files)}</small>}
            </div>
            <div className="code-file-list" aria-label="Files">
              {fileRows(files).map((r) =>
                r.kind === 'folder' ? (
                  <div key={`dir:${r.name}`} className="code-file folder">
                    <Icon name="folder" size={13} />
                    <span className="mono">{r.name}</span>
                  </div>
                ) : (
                  <button
                    key={r.path}
                    type="button"
                    aria-current={r.path === file?.path ? 'true' : undefined}
                    className={`code-file${r.nested ? ' nested' : ''}${r.path === file?.path ? ' active' : ''}`}
                    onClick={() => setActive(r.path)}
                  >
                    <Icon name={r.icon} size={13} />
                    <span className="mono code-file-name">{r.name}</span>
                    <small>{formatBytes(r.bytes)}</small>
                  </button>
                ),
              )}
            </div>
            {result.state === 'ok' && result.warnings.length > 0 && (
              <details className="code-warnings">
                <summary>
                  <Icon name="alert" size={13} />
                  {result.warnings.length} {result.warnings.length === 1 ? 'warning' : 'warnings'}
                </summary>
                <ul>
                  {result.warnings.map((w, i) => (
                    <li key={i}>{w.message}</li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        </div>
        <div className="code-preview">
          <div className="code-tabbar">
            {file && (
              <span className="code-tab">
                <Icon name="fileCode" size={13} />
                <span className="mono">{file.path}</span>
              </span>
            )}
            <span className="code-spacer" />
            {file && <small>{fileMeta(file.path, settings.target)}</small>}
            <button type="button" className="dp-icon-btn" aria-label="Copy file" title={copied === 'icon' ? 'Copied' : 'Copy file'} disabled={!file} onClick={() => void copyFile('icon')}>
              <Icon name={copied === 'icon' ? 'check' : 'copy'} size={13} />
            </button>
          </div>
          <div className="code-lines" tabIndex={0} aria-label={file ? `Code of ${file.path}` : 'Code'}>
            {result.state === 'loading' && <div className="spinner small" />}
            {result.state === 'error' && (
              <div className="code-error" role="alert">
                <Icon name="alert" size={13} />
                {result.message}
              </div>
            )}
            {result.state === 'ok' &&
              lines.map((toks, i) => (
                <div key={i} className="code-line">
                  <span className="code-no">{i + 1}</span>
                  <code>
                    {toks.map((t, j) =>
                      TOK_CLASS[t.kind] ? (
                        <span key={j} className={TOK_CLASS[t.kind]}>
                          {t.text}
                        </span>
                      ) : (
                        t.text
                      ),
                    )}
                  </code>
                </div>
              ))}
          </div>
        </div>
      </div>
      <footer className="code-footer">
        <Icon name="info" size={13} />
        <span className="code-note" role="status">
          {note ?? 'Same output as the export_code tool. Tokens become var(--…), components become React components.'}
        </span>
        <span className="code-spacer" />
        <button type="button" className="btn" disabled={!file} onClick={() => void copyFile('file')}>
          <Icon name={copied === 'file' ? 'check' : 'copy'} size={14} />
          {copied === 'file' ? 'Copied' : 'Copy file'}
        </button>
        <button type="button" className="btn primary" disabled={!files.length} onClick={downloadZip}>
          <Icon name="download" size={14} />
          Download .zip
        </button>
      </footer>
    </Modal>
  );
}
