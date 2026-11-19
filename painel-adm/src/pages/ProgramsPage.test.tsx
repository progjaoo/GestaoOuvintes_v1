import type { ReactNode } from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, it, expect, vi } from 'vitest';
import { ProgramsPage } from './ProgramsPage';
import { api } from '@/services/api';
const state = vi.hoisted(() => ({ permissions: ['program.read', 'program.manage', 'schedule.manage', 'program.host.manage'] }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'actor', permissions: state.permissions } }) }));
vi.mock('@/components/layout/AppShell', () => ({ AppShell: ({ children }: {
        children: ReactNode;
    }) => <main>{children}</main>, PageHeader: ({ title, actions }: {
        title: string;
        actions: ReactNode;
    }) => <header><h1>{title}</h1>{actions}</header> }));
const program = { id: 'program', name: 'Programa teste', slug: 'teste', description: 'Teste', active: true, version: 1 };
function open() { return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><ProgramsPage /></QueryClientProvider>); }
beforeEach(() => {
    state.permissions = ['program.read', 'program.manage', 'schedule.manage', 'program.host.manage'];
    vi.spyOn(api,'programmingWeek').mockResolvedValue({items:[]});
    vi.spyOn(api,'listProgrammingOverrides').mockResolvedValue({items:[]});
    vi.spyOn(api, 'listPrograms').mockResolvedValue({ items: [program], nextCursor: null });
    vi.spyOn(api, 'getProgram').mockResolvedValue({ program, slots: [], hosts: [] });
    vi.spyOn(api, 'eligibleProgramHosts').mockResolvedValue({ items: [] });
    vi.spyOn(api, 'saveProgram').mockResolvedValue(program);
});
describe('Programas e grade', () => {
    it('loads details without granting management to read-only profiles', async () => {
        state.permissions = ['program.read'];
        open();
        fireEvent.click(await screen.findByRole('button', { name: /Programa teste/ }));
        expect(await screen.findByRole('heading', { name: 'Grade semanal' })).toBeVisible();
        expect(screen.queryByRole('button', { name: 'Novo programa' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Adicionar horário' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Salvar vínculo' })).not.toBeInTheDocument();
        expect(api.eligibleProgramHosts).not.toHaveBeenCalled();
    });
    it('creates a program through the existing dialog', async () => {
        open();
        fireEvent.click(screen.getByRole('button', { name: 'Novo programa' }));
        fireEvent.change(screen.getByLabelText('Nome do programa'), { target: { value: 'Novo programa' } });
        fireEvent.change(screen.getByLabelText('Slug'), { target: { value: 'novo-programa' } });
        fireEvent.click(screen.getByRole('button', { name: 'Salvar programa' }));
        await waitFor(() => expect(api.saveProgram).toHaveBeenCalledWith({ name: 'Novo programa', slug: 'novo-programa', description: '', active: true,presenters:[],imageAssetId:null }, undefined));
    });
    it('renders a failed query without fabricating empty data', async () => {
        vi.mocked(api.listPrograms).mockRejectedValue(new Error('API indisponível'));
        open();
        expect(await screen.findByRole('alert')).toHaveTextContent('API indisponível');
    });

    it('submits the simulator and displays the program name', async () => {
        vi.spyOn(api,'simulateProgramming').mockResolvedValue({at:'2026-11-09T09:00:00Z',timezone:'America/Sao_Paulo',current:{programId:'program',name:'Programa teste',source:'weekly'}});
        open();
        fireEvent.click(await screen.findByRole('button', { name: /Programa teste/ }));
        fireEvent.change(await screen.findByLabelText('Instante da simulação (horário local do dispositivo)'),{target:{value:'2026-11-09T06:00'}});
        fireEvent.click(screen.getByRole('button',{name:'Simular'}));
        await waitFor(()=>expect(api.simulateProgramming).toHaveBeenCalled());
        expect(await screen.findByText(/Programa: Programa teste/)).toBeVisible();
    });
});
