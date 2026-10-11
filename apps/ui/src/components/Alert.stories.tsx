/** Alert + Toaster stories (design §7): neutral cards, only the icon carries severity. */
import { Alert, Button, ToastProvider, useToast } from './ui.js';

export default { title: 'Atoms/Alert', component: Alert };

export const Tones = {
  render: () => (
    <div style={{ display: 'grid', gap: 8, minWidth: 320 }}>
      <Alert tone="pass">Applied. The switch reports the change.</Alert>
      <Alert tone="warn">leaf01 changed outside the app. Refresh before editing.</Alert>
      <Alert tone="fail">Apply job J12 failed: validation error.</Alert>
      <Alert tone="note">Ada is editing swp1 on leaf01.</Alert>
    </div>
  ),
};

function PushDemo() {
  const push = useToast();
  return (
    <div style={{ display: 'flex', gap: 8 }}>
      <Button auto variant="secondary" onClick={() => push('pass', 'Applied on leaf01.')}>
        Pass
      </Button>
      <Button auto variant="secondary" onClick={() => push('warn', 'Discarded staged changes.')}>
        Warn
      </Button>
      <Button auto variant="secondary" onClick={() => push('fail', 'Stage failed.')}>
        Fail
      </Button>
    </div>
  );
}

export const Toaster = {
  render: () => (
    <ToastProvider>
      <PushDemo />
    </ToastProvider>
  ),
};
