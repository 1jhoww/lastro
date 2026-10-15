export interface Download {
  bytes: Buffer;
  filename: string;
  nextCursor?: string | null;
  rowCount?: number;
}
