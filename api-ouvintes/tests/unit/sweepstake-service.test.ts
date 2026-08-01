import { describe, expect, it } from "vitest";
import {
  buildAnimationNames,
  buildEntriesHash,
  selectWinner,
  type SweepstakeCandidate,
} from "../../src/services/sweepstake-service.js";

const candidates: SweepstakeCandidate[] = [
  {
    participationId: "00000000-0000-4000-8000-000000000001",
    name: "Ana Souza",
    city: "Volta Redonda",
    neighborhood: "Retiro",
    phone: "(24) 99999-0001",
  },
  {
    participationId: "00000000-0000-4000-8000-000000000002",
    name: "Bruno Lima",
    city: "Barra Mansa",
    neighborhood: "Centro",
    phone: "(24) 99999-0002",
  },
  {
    participationId: "00000000-0000-4000-8000-000000000003",
    name: "Carla Dias",
    city: "Pinheiral",
    neighborhood: "Varjao",
    phone: null,
  },
];

describe("sweepstake-service", () => {
  it("seleciona o participante indicado pelo gerador seguro injetado", () => {
    const winner = selectWinner(candidates, () => 1);

    expect(winner).toEqual(candidates[1]);
  });

  it("rejeita sorteio sem participantes", () => {
    expect(() => selectWinner([], () => 0)).toThrowError("NO_ELIGIBLE_PARTICIPANTS");
  });

  it("gera o mesmo hash para a mesma lista independentemente da ordem", () => {
    const ids = candidates.map((candidate) => candidate.participationId);

    expect(buildEntriesHash(ids)).toBe(buildEntriesHash([...ids].reverse()));
    expect(buildEntriesHash(ids)).toMatch(/^[a-f0-9]{64}$/);
  });

  it("limita a animacao e sempre termina com o vencedor", () => {
    const winner = candidates[2]!;
    const names = buildAnimationNames(candidates, winner, 2, () => 0);

    expect(names).toHaveLength(2);
    expect(names.at(-1)).toBe("Carla Dias");
  });
});
