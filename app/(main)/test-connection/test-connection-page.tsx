"use client";

import { trpc } from "@/lib/trpc/client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { CreateTestInput, TestTableOutput } from "@/server/schemas";

export function TestConnectionPage() {
  const [name, setName] = useState("");

  // Query to get all test records
  const {
    data: tests,
    isLoading,
    error,
    refetch,
  } = trpc.test.getAll.useQuery();

  // Mutation to create a new test record
  const createTest = trpc.test.create.useMutation({
    onSuccess: () => {
      setName("");
      refetch();
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (name.trim()) {
      createTest.mutate({ name });
    }
  };

  return (
    <div className="container mx-auto p-8 max-w-4xl">
      <h1 className="text-3xl font-bold mb-8">tRPC Connection Test</h1>

      <div className="grid gap-6">
        {/* Create Form */}
        <Card>
          <CardHeader>
            <CardTitle>Insert Test Record</CardTitle>
            <CardDescription>
              Create a new test record to verify tRPC mutations work
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="flex gap-4">
              <Input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Enter a name..."
                className="flex-1"
              />
              <Button
                type="submit"
                disabled={createTest.isPending || !name.trim()}
              >
                {createTest.isPending ? "Creating..." : "Insert"}
              </Button>
            </form>
            {createTest.error && (
              <p className="text-red-500 mt-2 text-sm">
                Error: {createTest.error.message}
              </p>
            )}
            {createTest.isSuccess && (
              <p className="text-green-500 mt-2 text-sm">
                ✓ Record created successfully!
              </p>
            )}
          </CardContent>
        </Card>

        {/* List of Records */}
        <Card>
          <CardHeader>
            <CardTitle>Test Records</CardTitle>
            <CardDescription>
              All records from the database (verifies tRPC queries work)
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading && <p className="text-muted-foreground">Loading...</p>}

            {error && <p className="text-red-500">Error: {error.message}</p>}

            {tests && tests.length === 0 && (
              <p className="text-muted-foreground">
                No records yet. Create one above!
              </p>
            )}

            {tests && tests.length > 0 && (
              <div className="space-y-2">
                {tests.map((test) => (
                  <div
                    key={test.id}
                    className="p-4 border rounded-lg flex justify-between items-center"
                  >
                    <div>
                      <p className="font-medium">{test.name}</p>
                      <p className="text-sm text-muted-foreground">
                        {new Date(test.createdAt).toLocaleString()}
                      </p>
                    </div>
                    <code className="text-xs bg-muted px-2 py-1 rounded">
                      {test.id}
                    </code>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Connection Status */}
        <Card>
          <CardHeader>
            <CardTitle>Connection Status</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span>tRPC Client:</span>
                <span className="text-green-500 font-medium">✓ Connected</span>
              </div>
              <div className="flex justify-between">
                <span>Database Query:</span>
                <span
                  className={
                    isLoading
                      ? "text-yellow-500"
                      : error
                      ? "text-red-500"
                      : "text-green-500"
                  }
                >
                  {isLoading ? "⟳ Loading..." : error ? "✗ Error" : "✓ Working"}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Type Safety:</span>
                <span className="text-green-500 font-medium">✓ Enabled</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
