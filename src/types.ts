export type Language = 'id' | 'en';
export type Page = 'discover' | 'recommendations' | 'saved';
export interface Fandom { id: number; name: string; kind: string }
export interface Booth {
  id: string;
  name: string;
  spaces: string[];
  days: string[];
  gallery: string[];
  thumbnail?: string;
  catalogUrl?: string;
  fandomIds: number[];
}
export interface Snapshot { version: number; booths: Booth[]; fandoms: Fandom[] }
export interface Decision {
  kind: 'like' | 'pass'; at: number; fandomIds: number[];
}
export interface FandomInterest {
  positive: number; negative: number; evidence: number;
  interest: number; confidence: number;
}
export type InterestProfile = Record<number, FandomInterest>;
export interface BatchCard { booth: Booth; reason: 'interest' | 'learning' | 'random'; preparedAt?: number; previousDecisionAt?: number }
export interface Visitor {
  schema: 1;
  seed: number;
  sequence: number;
  language: Language;
  decisions: Record<string, Decision>;
  saved: Record<string, Booth>;
  batches: BatchCard[][];
  revisit: boolean;
  revisitIds?: string[];
}
export interface BatchRequest {
  snapshot: Snapshot; decisions: Visitor['decisions'];
  excluded: string[]; queued: Booth[];
  seed: number; sequence: number; now: number; revisit: boolean;
  revisitIds?: string[];
}
export interface WorkerRequest { id: number; generation: number; request: BatchRequest }
export interface WorkerResponse {
  id: number; generation: number; cards?: BatchCard[]; error?: string;
}
