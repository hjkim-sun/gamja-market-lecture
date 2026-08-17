type AuthSubmitButtonProps = {
  idleLabel: string;
  pendingLabel: string;
  pending: boolean;
};

export default function AuthSubmitButton({ idleLabel, pendingLabel, pending }: AuthSubmitButtonProps) {
  return (
    <button className="gm-primary-button" type="submit" disabled={pending} aria-disabled={pending}>
      {pending && <span className="gm-spinner" aria-hidden="true" />}
      <span aria-live="polite">{pending ? pendingLabel : idleLabel}</span>
    </button>
  );
}
