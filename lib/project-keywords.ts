// Created by Cory McCabe
import { projectShortName, suggestProjectShortName, type Project } from './model';

export function normalizeProjectKeyword(value: string): string {
  return value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

export function uniqueProjectKeywords(values: string[]): string[] {
  const seen = new Set<string>();
  return values.map(value => value.trim().replace(/\s+/g, ' ')).filter(value => {
    if (!value) return false;
    const key = normalizeProjectKeyword(value) || value.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Local, explainable suggestions: no AI call and no silent changes to an
 * existing project. Accepted suggestions use the same editable aliases field. */
export function suggestProjectKeywords(
  name: string, shortName = '', projects: Project[] = [], projectId?: string,
): string[] {
  name = name.trim();
  if (!normalizeProjectKeyword(name)) return [];
  const label = shortName.trim() || suggestProjectShortName(name);
  const spaced = name.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/\bMc ([A-Z])/g, 'Mc$1');
  const candidates = [name.replace(/\s+/g, ''), spaced,
    name.replace(/&/g, 'and'), name.replace(/\band\b/gi, '&')];
  const domain = name.match(/^(.+)\.([a-z]{2,})$/i);
  if (domain) {
    candidates.push(`${domain[1]} dot ${domain[2]}`,
      `${spaced.slice(0, spaced.lastIndexOf('.'))} dot ${domain[2]}`);
  }
  if (/^[A-Z]{2,6}$/.test(label)) candidates.push(label.split('').join(' '));
  if (/Studios\b/i.test(name)) candidates.push(name.replace(/Studios\b/gi, 'Studio'));
  if (/Notes\b/i.test(name)) candidates.push(name.replace(/Notes\b/gi, 'Note'));
  if (normalizeProjectKeyword(name).replace(/ /g, '') === 'metanote')
    candidates.push('Meta Note', 'Minnow', 'Meta Notes', 'Metta Note');
  if (/\bBlanc\b/i.test(name)) candidates.push(name.replace(/\bBlanc\b/gi, 'Blank'));
  if (/\bThomson\b/i.test(name)) candidates.push(name.replace(/\bThomson\b/gi, 'Thompson'));
  if (normalizeProjectKeyword(name) === 'followthrough') candidates.push('Follow through');
  const excluded = new Set([name, label].map(normalizeProjectKeyword));
  for (const project of projects) {
    if (project.id === projectId) continue;
    for (const value of [project.name, projectShortName(project), ...project.aliases])
      excluded.add(normalizeProjectKeyword(value));
  }
  return uniqueProjectKeywords(candidates).filter(value => {
    const key = normalizeProjectKeyword(value);
    return key.length > 0 && value.length <= 100 && !excluded.has(key);
  }).slice(0, 8);
}
