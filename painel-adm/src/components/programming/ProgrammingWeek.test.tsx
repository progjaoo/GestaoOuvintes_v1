import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/services/api';
import { ProgrammingWeek } from './ProgrammingWeek';

function renderWeek(onSelect = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><ProgrammingWeek enabled onSelect={onSelect} /></QueryClientProvider>);
  return onSelect;
}

describe('ProgrammingWeek', () => {
  beforeEach(() => {
    vi.spyOn(api, 'programmingWeek').mockResolvedValue({ items: [
      { id: 'slot-mon', programId: 'program', programName: 'Fato Popular', weekday: 1, startMinute: 300, endMinute: 570, validFrom: '2026-11-09', validUntil: null, active: true, version: 1 },
    ] });
  });

  it('renders seven day cards and opens a selected program from its slot', async () => {
    const onSelect = renderWeek();
    expect(await screen.findByRole('region', { name: 'Segunda' })).toBeVisible();
    expect(screen.getByRole('region', { name: 'Domingo' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Abrir Fato Popular, Segunda, 05:00 às 09:30' }));
    expect(onSelect).toHaveBeenCalledWith('program');
  });

  it('shows an empty state when there are no scheduled slots', async () => {
    vi.mocked(api.programmingWeek).mockResolvedValue({ items: [] });
    renderWeek();
    expect(await screen.findByText('A semana ainda não tem horários.')).toBeVisible();
  });
});
