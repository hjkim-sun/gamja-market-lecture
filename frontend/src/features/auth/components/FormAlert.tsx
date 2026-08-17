type FormAlertProps = {
  tone: "error" | "success" | "info";
  children: React.ReactNode;
  id?: string;
};

const icons = { error: "!", success: "✓", info: "i" };

export default function FormAlert({ tone, children, id }: FormAlertProps) {
  return (
    <div id={id} className={`gm-alert gm-alert-${tone}`} role={tone === "error" ? "alert" : "status"}>
      <span className="gm-alert-icon" aria-hidden="true">{icons[tone]}</span>
      <span>{children}</span>
    </div>
  );
}
