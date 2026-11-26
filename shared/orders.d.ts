export type NoticeStatus = 'attente' | 'confirmee' | 'preparation' | 'expediee' | 'livree' | 'annulee';
export type ProStage = 'interet' | 'contacte' | 'discussion' | 'contrat' | 'preparation' | 'livraison' | 'livree' | 'annulee';
export const PRO_STAGES: { id: ProStage; label: string; status: NoticeStatus }[];
export function isProStage(id: unknown): id is ProStage;
export function proStageFromStatus(status: NoticeStatus): ProStage;
export function proStageOf(order: { stage?: string | null; status: NoticeStatus }): ProStage;
export function proStageLabel(id: ProStage): string;
export function statusOfProStage(id: ProStage): NoticeStatus;
export function isSenegal(country: string, address: string): boolean;
export function clientNotice(
  order: { reference: string; type: 'particulier' | 'pro'; abroad: boolean; airport?: string; door?: boolean; located?: boolean },
  status: NoticeStatus,
  stage?: string | null,
): { title: string; message: string };

export type AnnonceState = 'off' | 'scheduled' | 'live' | 'ended';
export function annonceState(
  row: { published: boolean; data?: { starts_at?: string | null; ends_at?: string | null } | null } | null | undefined,
  now?: number,
): AnnonceState;
