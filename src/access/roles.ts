import type { Access, FieldAccess, PayloadRequest } from 'payload'

export const ROLES = ['admin', 'editor'] as const
export type Role = (typeof ROLES)[number]

type MaybeUser = PayloadRequest['user'] | null | undefined

export function hasRole(user: MaybeUser, role: Role): boolean {
  const roles = (user as { roles?: unknown } | null | undefined)?.roles
  return Array.isArray(roles) && roles.includes(role)
}

export const isAdminUser = (user: MaybeUser): boolean => hasRole(user, 'admin')

export const isAdmin: Access = ({ req }) => isAdminUser(req.user)

export const isAdminField: FieldAccess = ({ req }) => isAdminUser(req.user)

export const isAuthenticated: Access = ({ req }) => Boolean(req.user)

/** Admins see everyone, other staff only themselves. */
export const isAdminOrSelf: Access = ({ req }) => {
  if (!req.user) return false
  if (isAdminUser(req.user)) return true
  return { id: { equals: req.user.id } }
}

export const denyAll = () => false
