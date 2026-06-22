/**
 * @fileoverview Build a downloadable `.zip` from a generated file map.
 *
 * Files are nested under a top-level directory named after the server so the
 * archive extracts into a single tidy folder.
 */
import JSZip from "jszip";

export async function zipProject(
  serverName: string,
  files: ReadonlyMap<string, string>,
): Promise<Buffer> {
  const zip = new JSZip();
  const root = zip.folder(serverName) ?? zip;
  for (const [path, contents] of files) {
    root.file(path, contents);
  }
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}
