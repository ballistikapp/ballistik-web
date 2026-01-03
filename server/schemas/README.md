# Shared Validation Schema Guide

This guide explains how to use the centralized Zod schema system for type-safe validation across your application.

## Overview

All validation schemas are defined in `server/schemas/` and shared across:

- **Service Layer** - Business logic with typed inputs/outputs
- **tRPC Endpoints** - API validation and type inference
- **Frontend** - Type-safe forms and API calls

## Directory Structure

```
server/schemas/
├── index.ts           # Central export point
├── test.schema.ts     # Test entity schemas
└── [entity].schema.ts # Add more as needed
```

## Creating a New Schema

### 1. Define the Schema File

Create `server/schemas/[entity].schema.ts`:

```typescript
import { z } from "zod";

// Input validation schema
export const createEntitySchema = z.object({
  name: z.string().min(1, "Name is required"),
  email: z.string().email("Invalid email"),
});

// Infer TypeScript types
export type CreateEntityInput = z.infer<typeof createEntitySchema>;

// Output type (matches Prisma model)
export type EntityOutput = {
  id: string;
  name: string;
  email: string;
  createdAt: Date;
};
```

### 2. Export from Index

Add to `server/schemas/index.ts`:

```typescript
export * from "./entity.schema";
```

## Using Schemas

### In tRPC Routers

```typescript
import { router, publicProcedure } from "../trpc";
import { createEntitySchema } from "@/server/schemas";
import { entityService } from "@/server/services";

export const entityRouter = router({
  create: publicProcedure
    .input(createEntitySchema) // ✅ Validation happens here
    .mutation(async ({ input }) => {
      // input is automatically typed as CreateEntityInput
      return await entityService.create(input);
    }),
});
```

### In Service Layer

```typescript
import type { CreateEntityInput, EntityOutput } from "@/server/schemas";

export const entityService = {
  async create(input: CreateEntityInput): Promise<EntityOutput> {
    // input is fully typed and validated
    return await prisma.entity.create({
      data: input,
    });
  },
};
```

### In Frontend Components

```typescript
import type { CreateEntityInput } from "@/server/schemas";
import { trpc } from "@/lib/trpc/client";

export function MyForm() {
  const createEntity = trpc.entity.create.useMutation();

  const handleSubmit = (data: CreateEntityInput) => {
    // data is type-safe and matches backend validation
    createEntity.mutate(data);
  };
}
```

## Benefits

✅ **Single Source of Truth** - Define validation once, use everywhere  
✅ **Type Safety** - Automatic TypeScript inference from Zod schemas  
✅ **Consistency** - Same validation rules on frontend and backend  
✅ **Maintainability** - Update validation in one place  
✅ **Self-Documenting** - Schemas serve as API documentation

## Validation Error Handling

Zod provides detailed error messages:

```typescript
const createEntitySchema = z.object({
  name: z.string().min(1, "Name is required").max(100, "Name is too long"),
  email: z.string().email("Invalid email format"),
});
```

These messages automatically appear in:

- tRPC error responses
- Frontend form validation
- Service layer type checking

## Best Practices

1. **Keep schemas focused** - One schema per entity/operation
2. **Use descriptive error messages** - Help users understand validation failures
3. **Export both schemas and types** - Schemas for validation, types for TypeScript
4. **Document complex validations** - Add comments for business rules
5. **Reuse common patterns** - Create helper schemas for repeated validations

## Example: Complete Flow

```typescript
// 1. Define schema (server/schemas/user.schema.ts)
export const createUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(2),
});
export type CreateUserInput = z.infer<typeof createUserSchema>;

// 2. Use in tRPC (server/trpc/routers/user.router.ts)
create: publicProcedure
  .input(createUserSchema)
  .mutation(({ input }) => userService.create(input))

// 3. Use in service (server/services/user.service.ts)
async create(input: CreateUserInput) {
  return await prisma.user.create({ data: input });
}

// 4. Use in frontend (app/components/user-form.tsx)
const createUser = trpc.user.create.useMutation();
createUser.mutate({ email: "test@example.com", name: "John" });
```

## Migration Guide

To migrate existing code to use shared schemas:

1. Create schema file in `server/schemas/`
2. Export from `server/schemas/index.ts`
3. Update tRPC router to import and use schema
4. Update service to use inferred types
5. Update frontend to import types
6. Remove duplicate validation code

---

For more information on Zod validation, see: https://zod.dev
