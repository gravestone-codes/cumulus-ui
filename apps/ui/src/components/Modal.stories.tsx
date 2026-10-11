/** Modal + Confirm stories (design §7): centered, blurred backdrop, typed danger gating. */
import { useState } from 'react';
import { Button, Confirm, Modal } from './ui.js';

function Opener({ title, children }: { title: string; children: (close: () => void) => React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button auto variant="secondary" onClick={() => setOpen(true)}>
        Open {title}
      </Button>
      {open && children(() => setOpen(false))}
    </>
  );
}

export default { title: 'Atoms/Modal', component: Modal };

export const Plain = {
  render: () => (
    <Opener title="modal">
      {(close) => (
        <Modal open onClose={close} title="Review change">
          <p style={{ fontSize: 14, color: 'var(--color-muted)' }}>Dry-run content goes here.</p>
        </Modal>
      )}
    </Opener>
  ),
};

export const ConfirmPlain = {
  render: () => {
    const [open, setOpen] = useState(false);
    return (
      <>
        <Button auto onClick={() => setOpen(true)}>
          Delete
        </Button>
        <Confirm
          open={open}
          title="Delete bond0?"
          body="/interface/bond0 on leaf01. This cannot be undone."
          confirmLabel="Delete"
          danger
          onConfirm={() => setOpen(false)}
          onCancel={() => setOpen(false)}
        />
      </>
    );
  },
};

export const ConfirmServiceAck = {
  render: () => {
    const [open, setOpen] = useState(false);
    return (
      <>
        <Button auto onClick={() => setOpen(true)}>
          Delete VLAN
        </Button>
        <Confirm
          open={open}
          title="Delete br_default?"
          body="/bridge/domain/br_default on leaf01. This affects traffic and cannot be undone."
          confirmLabel="Delete"
          danger
          ackLabel="I understand this affects traffic"
          onConfirm={() => setOpen(false)}
          onCancel={() => setOpen(false)}
        />
      </>
    );
  },
};

export const ConfirmTypedDanger = {
  render: () => {
    const [open, setOpen] = useState(false);
    return (
      <>
        <Button auto variant="danger" onClick={() => setOpen(true)}>
          Remove break-glass user
        </Button>
        <Confirm
          open={open}
          title="Delete operator?"
          body="/system/aaa/user/operator on leaf01. This is dangerous and cannot be undone."
          confirmLabel="Delete"
          danger
          requireText="operator"
          onConfirm={() => setOpen(false)}
          onCancel={() => setOpen(false)}
        />
      </>
    );
  },
};
