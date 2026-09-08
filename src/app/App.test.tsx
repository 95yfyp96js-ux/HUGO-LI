import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from './App';

describe('App', () => {
  it('renders the home page core journey entry point', async () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>,
    );
    expect(await screen.findByText('此刻，想從哪個心願開始？')).toBeInTheDocument();
  });

  it('renders explore page with deity list after loading', async () => {
    render(
      <MemoryRouter initialEntries={['/explore']}>
        <App />
      </MemoryRouter>,
    );
    expect(await screen.findByText('媽祖')).toBeInTheDocument();
  });

  it('shows not found page for unknown routes', async () => {
    render(
      <MemoryRouter initialEntries={['/does-not-exist']}>
        <App />
      </MemoryRouter>,
    );
    expect(await screen.findByText('找不到這個頁面')).toBeInTheDocument();
  });
});
