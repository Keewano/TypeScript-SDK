/**
 * Role a scratch sibling plays in an adapter's mutation protocol:
 * `tmp` stages an incomplete write, `bak` holds the rename-aside of
 * the previous destination contents, `del` is the trash-rename of a
 * file being deleted.
 */
type ScratchKind = 'bak' | 'del' | 'tmp';

/**
 * Parsed identity of a scratch-sibling basename.
 *
 * destinationName - Basename of the destination file the sibling belongs to.
 * kind - Scratch role the marker carries.
 */
interface ParsedScratchSibling {
  destinationName: string;
  kind: ScratchKind;
}

export type { ParsedScratchSibling, ScratchKind };
