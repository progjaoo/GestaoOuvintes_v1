type CampaignEventClient = {
  id: string;
  placement: string;
  send: (event: string, data: unknown) => void;
};

const clients = new Map<string, CampaignEventClient>();

export function addCampaignEventClient(client: CampaignEventClient) {
  clients.set(client.id, client);
  return () => {
    clients.delete(client.id);
  };
}

export function emitCampaignChanged(placement: string, version: number) {
  for (const client of clients.values()) {
    if (client.placement !== placement) continue;
    client.send("campaign.changed", { placement, version });
  }
}
