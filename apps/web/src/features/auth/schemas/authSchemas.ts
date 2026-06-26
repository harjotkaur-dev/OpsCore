import { z } from 'zod'

export const loginSchema = z.object({
  email: z
    .string()
    .min(1, 'Email is required')
    .email('Must be a valid email address'),
  password: z.string().min(1, 'Password is required'),
})

export const registerSchema = z.object({
  organizationName: z
    .string()
    .min(1, 'Organization name is required')
    .max(100, 'Organization name must be 100 characters or fewer'),
  fullName: z
    .string()
    .min(1, 'Full name is required')
    .max(100, 'Full name must be 100 characters or fewer'),
  email: z
    .string()
    .min(1, 'Email is required')
    .email('Must be a valid email address'),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .max(128, 'Password must be 128 characters or fewer'),
})

export const acceptInviteSchema = z
  .object({
    fullName: z
      .string()
      .min(1, 'Full name is required')
      .max(100, 'Full name must be 100 characters or fewer'),
    password: z
      .string()
      .min(8, 'Password must be at least 8 characters')
      .max(128, 'Password must be 128 characters or fewer'),
    confirmPassword: z.string().min(1, 'Please confirm your password'),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  })

export type LoginFormData = z.infer<typeof loginSchema>
export type RegisterFormData = z.infer<typeof registerSchema>
export type AcceptInviteFormData = z.infer<typeof acceptInviteSchema>
