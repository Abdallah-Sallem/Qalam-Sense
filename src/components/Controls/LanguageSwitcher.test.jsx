import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import LanguageSwitcher from './LanguageSwitcher';
import { __languageStore } from '../../hooks/useLanguage';

beforeEach(() => {
  window.localStorage.clear();
  __languageStore.setLanguageStore('fr');
});

test('toggles language and updates polite live region', async () => {
  render(<LanguageSwitcher />);

  const button = screen.getByRole('button', { name: 'Switch language' });
  await userEvent.click(button);

  expect(screen.getByText('Language switched to Arabic')).toBeInTheDocument();
});

test('supports keyboard toggle with Space', async () => {
  render(<LanguageSwitcher />);

  const button = screen.getByRole('button', { name: 'Switch language' });
  button.focus();
  await userEvent.keyboard('[Space]');

  expect(screen.getByText('Language switched to Arabic')).toBeInTheDocument();
});

test('supports keyboard toggle with Enter', async () => {
  render(<LanguageSwitcher />);

  const button = screen.getByRole('button', { name: 'Switch language' });
  button.focus();
  await userEvent.keyboard('[Enter]');

  expect(screen.getByText('Language switched to Arabic')).toBeInTheDocument();
});
