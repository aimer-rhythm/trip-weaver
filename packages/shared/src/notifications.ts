import { Type, type Static } from '@sinclair/typebox';

const sequence = Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER });
export const GenerationNotificationSchema = Type.Object({
  id: Type.String(),
  sequence,
  jobId: Type.String(),
  kind: Type.Union([Type.Literal('success'), Type.Literal('error')]),
  tripId: Type.Union([Type.String(), Type.Null()]),
  title: Type.String(),
  message: Type.String(),
  createdAt: Type.Number(),
  readAt: Type.Union([Type.Number(), Type.Null()]),
});
export type GenerationNotification = Static<typeof GenerationNotificationSchema>;
export const NotificationPageSchema = Type.Object({
  items: Type.Array(GenerationNotificationSchema),
  hasUnread: Type.Boolean(),
  readThrough: sequence,
  nextCursor: Type.Union([sequence, Type.Null()]),
});
export type NotificationPage = Static<typeof NotificationPageSchema>;
export const NotificationQuerySchema = Type.Object({
  before: Type.Optional(sequence),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 50, default: 20 })),
});
export const NotificationReadAllSchema = Type.Object({ through: sequence });
export const GenerationJobViewSchema = Type.Object({
  jobId: Type.String(),
  status: Type.Union([Type.Literal('running'), Type.Literal('done'), Type.Literal('error'), Type.Literal('cancelled')]),
  tripId: Type.Union([Type.String(), Type.Null()]),
  createdAt: Type.Number(),
  destination: Type.Optional(Type.String()),
  days: Type.Optional(Type.Number()),
  message: Type.Optional(Type.String()),
});
