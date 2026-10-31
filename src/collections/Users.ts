import { APIError, ValidationError, type CollectionConfig, type PayloadRequest } from 'payload'

import { isAdmin, isAdminField, isAdminOrSelf, ROLES } from '../access/roles'

const LAST_ADMIN_MESSAGE =
  'Это последний администратор. Сначала назначьте администратором другого сотрудника — иначе настройки сайта станут недоступны.'

function rolesOf(doc: unknown): string[] {
  const roles = (doc as { roles?: unknown } | null | undefined)?.roles
  return Array.isArray(roles) ? (roles as string[]) : []
}

async function otherAdminsCount(req: PayloadRequest, id: number | string): Promise<number> {
  const { totalDocs } = await req.payload.count({
    collection: 'users',
    overrideAccess: true,
    req,
    where: { and: [{ roles: { in: ['admin'] } }, { id: { not_equals: id } }] },
  })
  return totalDocs
}

/** Staff accounts for the admin panel (not customers — customers live in X.Label). */
export const Users: CollectionConfig = {
  slug: 'users',
  labels: { singular: 'Сотрудник', plural: 'Сотрудники' },
  admin: {
    useAsTitle: 'email',
    defaultColumns: ['email', 'name', 'roles'],
    group: 'Администрирование',
  },
  auth: {
    tokenExpiration: 60 * 60 * 8,
    maxLoginAttempts: 5,
    lockTime: 15 * 60 * 1000,
    cookies: { sameSite: 'Lax', secure: process.env.NODE_ENV === 'production' },
  },
  access: {
    // Creating the very first user is allowed by Payload's own "create first user" flow.
    create: isAdmin,
    read: isAdminOrSelf,
    update: isAdminOrSelf,
    delete: isAdmin,
    admin: ({ req }) => Boolean(req.user),
  },
  hooks: {
    beforeChange: [
      // The first account becomes an administrator, otherwise nobody could manage the site.
      async ({ data, operation, req }) => {
        if (operation !== 'create') return data
        const existing = await req.payload.count({ collection: 'users', overrideAccess: true, req })
        if (existing.totalDocs === 0) {
          return { ...data, roles: ['admin'] }
        }
        return data
      },
      // Never leave the site without an administrator.
      async ({ data, operation, originalDoc, req }) => {
        if (operation !== 'update' || !originalDoc) return data
        const wasAdmin = rolesOf(originalDoc).includes('admin')
        const staysAdmin = data.roles === undefined || rolesOf(data).includes('admin')
        if (wasAdmin && !staysAdmin && (await otherAdminsCount(req, originalDoc.id)) === 0) {
          throw new ValidationError({
            collection: 'users',
            errors: [{ path: 'roles', message: LAST_ADMIN_MESSAGE }],
          })
        }
        return data
      },
    ],
    beforeDelete: [
      async ({ id, req }) => {
        const doc = await req.payload.findByID({
          collection: 'users',
          id,
          overrideAccess: true,
          req,
          depth: 0,
        })
        if (rolesOf(doc).includes('admin') && (await otherAdminsCount(req, id)) === 0) {
          throw new APIError(LAST_ADMIN_MESSAGE, 400, undefined, true)
        }
      },
    ],
  },
  fields: [
    {
      name: 'name',
      type: 'text',
      label: 'Имя',
    },
    {
      name: 'roles',
      type: 'select',
      label: 'Роли',
      hasMany: true,
      required: true,
      defaultValue: ['editor'],
      saveToJWT: true,
      options: [
        { label: 'Администратор', value: ROLES[0] },
        { label: 'Редактор контента', value: ROLES[1] },
      ],
      access: {
        // Only admins can grant or change roles (including their own).
        create: isAdminField,
        update: isAdminField,
      },
      admin: {
        description:
          'Администратор управляет сотрудниками и настройками интеграции X.Label. Редактор — только контентом.',
      },
    },
  ],
}
