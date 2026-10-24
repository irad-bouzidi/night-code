export function Header() {
  return (
    <box justifyContent="center" alignItems="center">
      <box
        flexDirection="row"
        justifyContent="center"
        gap={0.5}
        alignItems="center"
      >
        <ascii-font font="tiny" text="Rise" color="#4877BD"></ascii-font>
        <ascii-font font="tiny" text=" - " color="grey"></ascii-font>
        <ascii-font font="tiny" text="Code" color="#484F9D"></ascii-font>
      </box>
    </box>
  );
}
