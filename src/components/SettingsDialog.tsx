import { Eye, EyeOff, KeyRound, X } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import type { AppSettings } from "../domain/types";

interface SettingsDialogProps {
  initial: AppSettings;
  onSave: (settings: AppSettings, password: string, searchApiKey: string) => Promise<void>;
  onInstallSearch: (settings: AppSettings, password: string) => Promise<void>;
  onClose: () => void;
}

type Tab = "connection" | "wake" | "runtime" | "search" | "application";

export function SettingsDialog({ initial, onSave, onInstallSearch, onClose }: SettingsDialogProps) {
  const [settings, setSettings] = useState(initial);
  const [password, setPassword] = useState("");
  const [searchApiKey, setSearchApiKey] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [tab, setTab] = useState<Tab>("connection");
  const [saving, setSaving] = useState(false);
  const [installingSearch, setInstallingSearch] = useState(false);
  const [searchSetupStatus, setSearchSetupStatus] = useState("");

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !saving) onClose();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [onClose, saving]);

  const update = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) =>
    setSettings((current) => ({ ...current, [key]: value }));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      await onSave(settings, password, searchApiKey);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const installSearch = async () => {
    setInstallingSearch(true);
    setSearchSetupStatus("");
    try {
      await onInstallSearch(settings, password);
      setSearchSetupStatus("Windows SearXNG가 준비되었습니다. 설정을 저장하면 SSH 터널로 연결됩니다.");
    } catch (error) {
      setSearchSetupStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setInstallingSearch(false);
    }
  };

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <p className="eyebrow">LOCAL LLM</p>
            <h2 id="settings-title">설정</h2>
          </div>
          <button type="button" className="icon-button" aria-label="설정 닫기" onClick={onClose}>
            <X size={19} />
          </button>
        </header>
        <div className="settings-body">
          <nav className="settings-nav" aria-label="설정 섹션">
            {([
              ["connection", "연결"],
              ["wake", "Wake-on-LAN"],
              ["runtime", "런타임"],
              ["search", "웹 검색"],
              ["application", "애플리케이션"],
            ] as const).map(([id, label]) => (
              <button
                type="button"
                className={tab === id ? "active" : ""}
                key={id}
                onClick={() => setTab(id)}
              >
                {label}
              </button>
            ))}
          </nav>
          <form id="settings-form" className="settings-form" onSubmit={submit}>
            {tab === "connection" ? (
              <>
                <div className="section-copy"><h3>Windows 연결</h3><p>SSH 접속 정보는 로컬에서만 사용됩니다.</p></div>
                <label><span>호스트</span><input value={settings.host} placeholder="192.168.0.10 또는 DDNS" onChange={(event) => update("host", event.target.value)} /></label>
                <div className="field-row">
                  <label><span>SSH 포트</span><input type="number" min="1" max="65535" value={settings.sshPort} onChange={(event) => update("sshPort", Number(event.target.value))} /></label>
                  <label><span>사용자 이름</span><input value={settings.username} placeholder="windows-user" onChange={(event) => update("username", event.target.value)} /></label>
                </div>
                <label><span>인증 방식</span><select value={settings.authentication} onChange={(event) => update("authentication", event.target.value as AppSettings["authentication"])}><option value="key">SSH 개인 키</option><option value="password">암호</option></select></label>
                {settings.authentication === "key" ? (
                  <label><span>개인 키 경로</span><input value={settings.privateKeyPath} onChange={(event) => update("privateKeyPath", event.target.value)} /></label>
                ) : (
                  <label><span>SSH 암호</span><div className="password-field"><KeyRound size={16} /><input type={showPassword ? "text" : "password"} value={password} autoComplete="new-password" placeholder="macOS Keychain에 저장" onChange={(event) => setPassword(event.target.value)} /><button type="button" aria-label={showPassword ? "암호 숨기기" : "암호 보기"} onClick={() => setShowPassword((value) => !value)}>{showPassword ? <EyeOff size={16} /> : <Eye size={16} />}</button></div></label>
                )}
              </>
            ) : null}
            {tab === "wake" ? (
              <>
                <div className="section-copy"><h3>Wake-on-LAN</h3><p>라우터 UI 자동화 없이 표준 Magic Packet을 사용합니다.</p></div>
                <label><span>Wake Provider</span><select value={settings.wakeProvider} onChange={(event) => update("wakeProvider", event.target.value as AppSettings["wakeProvider"])}><option value="magic-packet">Magic Packet</option><option value="custom">Custom Command</option></select></label>
                {settings.wakeProvider === "magic-packet" ? <><label><span>MAC 주소</span><input value={settings.macAddress} placeholder="AA:BB:CC:DD:EE:FF" onChange={(event) => update("macAddress", event.target.value)} /></label><label><span>브로드캐스트 주소</span><input value={settings.broadcastAddress} onChange={(event) => update("broadcastAddress", event.target.value)} /></label></> : <label><span>사용자 지정 명령</span><input value={settings.customWakeCommand} placeholder="검증된 로컬 실행 파일 경로" onChange={(event) => update("customWakeCommand", event.target.value)} /></label>}
              </>
            ) : null}
            {tab === "runtime" ? (
              <><div className="section-copy"><h3>런타임</h3><p>모델별 명령과 API 주소는 Model Registry에서 관리됩니다.</p></div><div className="info-panel"><strong>llama.cpp · OpenAI 호환 API</strong><p>기본 연결은 임시 localhost 포트를 사용하는 SSH tunnel입니다.</p><p>모델 프로필 편집 UI는 다음 마일스톤에서 제공됩니다.</p></div><label className="toggle-row"><span><strong>Direct LAN API (Debug)</strong><small>SSH tunnel을 우회합니다. 신뢰할 수 있는 개발망에서만 사용하세요.</small></span><input type="checkbox" checked={settings.directApiMode} onChange={(event) => update("directApiMode", event.target.checked)} /></label></>
            ) : null}
            {tab === "search" ? (
              <>
                <div className="section-copy"><h3>웹 검색</h3><p>Windows의 SearXNG를 SSH 터널로 사용하면 검색 API 크레딧 제한 없이 검색할 수 있습니다.</p></div>
                <label><span>Search Provider</span><select value={settings.searchProvider} onChange={(event) => update("searchProvider", event.target.value as AppSettings["searchProvider"])}><option value="searxng-tavily">SearXNG 우선 · Tavily 폴백</option><option value="searxng">SearXNG만 사용</option><option value="tavily">Tavily만 사용</option></select></label>
                {settings.searchProvider !== "tavily" ? <label><span>Windows SearXNG 주소</span><input type="url" value={settings.searxngBaseUrl} placeholder="http://127.0.0.1:8888" onChange={(event) => update("searxngBaseUrl", event.target.value)} /><small>Windows 내부 주소를 입력하세요. localhost 주소는 SSH 터널로만 연결됩니다.</small></label> : null}
                {settings.searchProvider !== "searxng" ? <label><span>Tavily API 키 (선택)</span><div className="password-field"><KeyRound size={16} /><input type={showPassword ? "text" : "password"} value={searchApiKey} autoComplete="new-password" placeholder="폴백을 사용할 때만 입력" onChange={(event) => setSearchApiKey(event.target.value)} /></div></label> : null}
                <div className="field-row">
                  <label><span>최대 검색 결과</span><input type="number" min="1" max="10" value={settings.searchMaxResults} onChange={(event) => update("searchMaxResults", Number(event.target.value))} /></label>
                  <label><span>검색 제한 시간 (ms)</span><input type="number" min="1000" max="60000" step="1000" value={settings.searchTimeoutMs} onChange={(event) => update("searchTimeoutMs", Number(event.target.value))} /></label>
                </div>
                <div className="info-panel"><strong>모델 응답 시간</strong><p>답변 생성은 시간 제한 없이 계속되며, 작성 중에는 취소 버튼으로 직접 중단할 수 있습니다.</p></div>
                <div className="info-panel"><strong>검색 순서</strong><p>SearXNG 우선 모드는 Windows 자체 인스턴스가 실패하거나 결과가 없을 때만 Tavily를 호출합니다. SearXNG 포트는 외부나 LAN에 공개하지 않습니다.</p></div>
                <div className="info-panel"><strong>Windows 검색 서버</strong><p>Windows에 Docker Desktop이 설치되어 실행 중이어야 합니다.</p><button type="button" className="secondary" disabled={installingSearch || saving} onClick={() => void installSearch()}>{installingSearch ? "설치 및 확인 중..." : "Windows에 SearXNG 설치/시작"}</button>{searchSetupStatus ? <p role="status">{searchSetupStatus}</p> : null}</div>
                <div className="info-panel"><strong>보안 저장</strong><p>Tavily 키는 localStorage에 기록되지 않으며 설정 저장 시 macOS Keychain 또는 Windows Credential Manager에 저장됩니다.</p></div>
              </>
            ) : null}
            {tab === "application" ? (
              <><div className="section-copy"><h3>애플리케이션</h3><p>개발과 실제 사용 환경을 전환합니다.</p></div><label className="toggle-row"><span><strong>Mock Mode</strong><small>Windows 없이 전체 흐름을 시뮬레이션합니다.</small></span><input type="checkbox" checked={settings.mockMode} onChange={(event) => update("mockMode", event.target.checked)} /></label><label className="toggle-row"><span><strong>Advanced Mode</strong><small>상세 연결 로그를 표시합니다.</small></span><input type="checkbox" checked={settings.advancedMode} onChange={(event) => update("advancedMode", event.target.checked)} /></label><label><span>앱 종료 시</span><select value={settings.closeBehavior} onChange={(event) => update("closeBehavior", event.target.value as AppSettings["closeBehavior"])}><option value="nothing">아무 작업도 하지 않음</option><option value="stop-runtime">모델 런타임 중지</option><option value="sleep-windows">Windows 절전</option></select></label></>
            ) : null}
          </form>
        </div>
        <footer><span>{settings.mockMode ? "Mock Mode 활성화" : "실제 Windows 연결"}</span><div><button type="button" className="secondary" onClick={onClose}>취소</button><button type="submit" form="settings-form" disabled={saving}>{saving ? "저장 중..." : "설정 저장"}</button></div></footer>
      </section>
    </div>
  );
}
