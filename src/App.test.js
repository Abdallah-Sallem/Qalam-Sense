import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import App from './App';
import { __languageStore } from './hooks/useLanguage';

beforeEach(() => {
  window.localStorage.clear();
  __languageStore.setLanguageStore('fr');
});

test('switches from french to arabic without reload and updates direction', async () => {
  render(<App />);

  const reader = screen.getByLabelText('Reader content');
  expect(reader).toHaveAttribute('dir', 'ltr');
  expect(reader).toHaveAttribute('lang', 'fr');

  const switchButton = screen.getByRole('button', { name: 'Switch language' });
  await userEvent.click(switchButton);

  expect(reader).toHaveAttribute('dir', 'rtl');
  expect(reader).toHaveAttribute('lang', 'ar');
});

test('has no accessibility violations', async () => {
  const { container } = render(<App />);
  const results = await axe(container);
  expect(results).toHaveNoViolations();
});
