import appIconUrl from "../../src-tauri/icons/icon.svg";

export function AppIcon() {
  return (
    <img
      className="app-icon-image"
      src={appIconUrl}
      alt=""
      aria-hidden="true"
      draggable={false}
    />
  );
}
