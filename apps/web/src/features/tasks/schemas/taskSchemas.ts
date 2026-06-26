import { z } from 'zod'

export const taskPrioritySchema = z.enum(['low', 'medium', 'high', 'critical'])
export const taskStatusSchema = z.enum(['pending', 'in_progress', 'completed', 'cancelled'])

export const createTaskSchema = z.object({
  title: z.string().min(1, 'Title is required').max(255, 'Title must be 255 characters or fewer'),
  description: z.string().optional(),
  priority: taskPrioritySchema,
  dueDate: z.string().optional(),
})

export const updateTaskStatusSchema = z.object({
  status: z.enum(['in_progress', 'completed', 'cancelled']),
})

export const addCommentSchema = z.object({
  body: z.string().min(1, 'Comment cannot be empty'),
})

export type CreateTaskFormValues = z.infer<typeof createTaskSchema>
export type UpdateTaskStatusFormValues = z.infer<typeof updateTaskStatusSchema>
export type AddCommentFormValues = z.infer<typeof addCommentSchema>
