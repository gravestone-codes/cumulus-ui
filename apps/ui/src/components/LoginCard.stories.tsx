/** LoginCard stories (design §7 login): centered card, line fields, SVG eye, spinner submit. */
import { LoginCard } from './LoginCard.js';

export default {
  title: 'Atoms/LoginCard',
  component: LoginCard,
  decorators: [
    (Story: () => React.ReactElement) => (
      <div style={{ minWidth: 360 }}>
        <Story />
      </div>
    ),
  ],
};

function noop() {}

export const Empty = { args: { onSubmit: noop } };
export const Busy = { args: { busy: true, onSubmit: noop } };
export const Rejected = { args: { error: 'Invalid username or password.', onSubmit: noop } };
