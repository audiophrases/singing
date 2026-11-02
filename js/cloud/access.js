import { cloudSession } from './session.js';

export const teacherArea = (pathname = globalThis.location?.pathname || '/') => /\/create(?:\/(?:index\.html)?)?$/.test(pathname);
export const isTeacher = (principal = cloudSession().principal) => ['owner', 'teacher'].includes(principal?.role);
// Only the owner's songs can be on the public player.
export const isOwner = (principal = cloudSession().principal) => principal?.role === 'owner';
export const teacherAccess = (pathname = globalThis.location?.pathname || '/', principal = cloudSession().principal) => teacherArea(pathname) && isTeacher(principal);
export const assignmentRoute = (path, query = {}) => /^\/assignments$/.test(path) || /^\/assignment\/[^/]+$/.test(path) || (path.startsWith('/play/') && !!query.attempt);
export const publicUrl = (hash, origin = location.origin, pathname = location.pathname) => `${origin}${pathname.replace(/\/create(?:\/index\.html)?\/?$/, '/')}${hash}`;
export const teacherUrl = (hash, pathname = location.pathname) => `${pathname.replace(/index\.html$/, '').replace(/\/?$/, '/')}create/${hash}`;
