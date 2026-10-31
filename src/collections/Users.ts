import type { CollectionConfig } from 'payload'

import { isAdmin, isAdminField, isAdminOrSelf, ROLES } from '../access/roles'

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
