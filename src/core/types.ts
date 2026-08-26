export interface TreeEntry {
  hash: string;
  size: number;
}

export type Tree = Record<string, TreeEntry>;

export interface Checkpoint {
  id: string;
  parents: string[];
  tree: string;
  message: string;
  timestamp: string;
  meta: Record<string, unknown>;
  branch: string;
}

export interface IndexEntry {
  branch: string;
  message: string;
  timestamp: string;
}

export type Index = Record<string, IndexEntry>;
