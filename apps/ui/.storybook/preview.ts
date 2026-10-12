import type { Preview } from '@storybook/react-vite';
import '../src/index.css';

const preview: Preview = {
  parameters: {
    backgrounds: {
      default: 'owl',
      values: [{ name: 'owl', value: '#100e0c' }],
    },
  },
};

export default preview;
