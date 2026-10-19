import { isZip, usableFilesInZip } from './zip';

export const CARTRIDGE_EXTENSIONS = ['.a26', '.bin', '.rom'];
const MAX_IMAGE_SIZE = 0x80000;

export type Media =
  | { kind: 'cartridge'; image: Uint8Array; name: string }
  | { kind: 'state'; bytes: Uint8Array; name: string };

/** gzip files start with $1F $8B; save states are gzipped. */
export function looksLikeSaveState(bytes: Uint8Array): boolean {
  return bytes[0] === 0x1f && bytes[1] === 0x8b;
}

/** A display name from a file name: no extension, underscores as spaces. */
export function titleFromFileName(name: string): string {
  return name.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').trim() || name;
}

/** Works out what a file is: a cartridge image or a save state. */
export async function readMedia(file: File): Promise<Media> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const name = file.name.toLowerCase();
  if (name.endsWith('.a26state') || looksLikeSaveState(bytes)) return { kind: 'state', bytes, name: file.name };
  const knownExtension = CARTRIDGE_EXTENSIONS.some((ext) => name.endsWith(ext));
  if (bytes.length === 0) throw new Error(`${file.name} is empty.`);
  if (bytes.length > MAX_IMAGE_SIZE) throw new Error(`${file.name} is too big to be an Atari 2600 cartridge.`);
  // Files with other extensions are accepted if their size looks like a cartridge.
  if (!knownExtension && bytes.length % 0x800 !== 0) {
    throw new Error(`${file.name} isn't something the Atari can use. Try a .a26, .bin or .rom file.`);
  }
  return { kind: 'cartridge', image: bytes, name: file.name };
}

/** The usable files in a dropped file: itself, or the cartridge images and states inside a zip. */
export async function filesFrom(file: File): Promise<File[]> {
  const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  if (!isZip(head) && !file.name.toLowerCase().endsWith('.zip')) return [file];
  const files = await usableFilesInZip(new Uint8Array(await file.arrayBuffer()));
  if (files.length === 0) throw new Error(`${file.name} has no cartridge images in it.`);
  return files;
}

/** FNV-1a, used where the browser has no SubtleCrypto (pages not served securely). */
function fnv1a(bytes: Uint8Array): string {
  let hash = 0x811c9dc5;
  for (const byte of bytes) hash = Math.imul(hash ^ byte, 0x01000193) >>> 0;
  return `fnv-${hash.toString(16).padStart(8, '0')}`;
}

/** A stable identifier for a ROM image (its SHA-1), used to remember per-game settings. */
export async function romId(image: Uint8Array): Promise<string> {
  if (!globalThis.crypto?.subtle) return fnv1a(image);
  const digest = await crypto.subtle.digest('SHA-1', new Uint8Array(image));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
