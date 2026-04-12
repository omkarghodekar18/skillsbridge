"use client"

import { useEffect, useMemo, useState } from "react"
import { useParams } from "next/navigation"
import { useAuth } from "@clerk/nextjs"
import Link from "next/link"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ArrowLeft, BookOpen, ExternalLink, Loader2, Target } from "lucide-react"

interface UpskillTopic {
  skill: string
  reason: string
  resources: string[]
}

interface InterviewItem {
  _id: string
  job_title?: string
  created_at?: string
  ai_evaluation?: {
    summary?: string
    upskill_topics?: UpskillTopic[]
  }
}

export default function UpskillingDetailPage() {
  const params = useParams()
  const { getToken } = useAuth()

  const [item, setItem] = useState<InterviewItem | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [creatingPlan, setCreatingPlan] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  useEffect(() => {
    let active = true

    async function loadPlan() {
      setLoading(true)
      setError(null)
      try {
        const token = await getToken()
        const res = await fetch(
          `${process.env.NEXT_PUBLIC_API_URL}/api/interviews/${String(params.id)}`,
          { headers: { Authorization: `Bearer ${token}` } }
        )

        if (!res.ok) {
          throw new Error("Plan not found")
        }

        const data = await res.json()
        if (active) {
          setItem(data.item || null)
        }
      } catch {
        if (active) setError("Could not load this upskilling plan")
      } finally {
        if (active) setLoading(false)
      }
    }

    if (params.id) {
      void loadPlan()
    }

    return () => {
      active = false
    }
  }, [getToken, params.id])

  const topics = useMemo(() => item?.ai_evaluation?.upskill_topics || [], [item])
  const summary = (item?.ai_evaluation?.summary || "").trim()

  const handleCreatePlan = async () => {
    if (!params.id) return

    setCreatingPlan(true)
    setCreateError(null)

    try {
      const token = await getToken()
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/api/interviews/${String(params.id)}/upskill-plan`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ force: true }),
        }
      )

      if (!res.ok) {
        throw new Error("Could not generate upskill plan")
      }

      const data = await res.json()
      setItem(data.item || null)
    } catch {
      setCreateError("Failed to generate upskill plan. Please try again.")
    } finally {
      setCreatingPlan(false)
    }
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-background p-8 flex items-center justify-center">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading plan...
        </div>
      </main>
    )
  }

  if (error || !item) {
    return (
      <main className="min-h-screen bg-background p-8 flex items-center justify-center">
        <p className="text-sm text-red-500">{error || "Plan not found"}</p>
      </main>
    )
  }

  const dateLabel = item.created_at
    ? new Date(item.created_at).toLocaleDateString("en-IN", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : ""

  return (
    <main className="min-h-screen bg-background p-8">
      <div className="mx-auto max-w-3xl space-y-6">
        <div>
          <Link
            href="/dashboard/upskilling"
            className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-4 w-4" /> Back to plans
          </Link>
          <h1 className="text-3xl font-bold">{item.job_title || "Interview Plan"}</h1>
          <p className="mt-1 text-muted-foreground">{dateLabel || "Recent interview"} · Personalized improvement roadmap</p>
        </div>

        {summary ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">AI Summary</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground leading-relaxed">
              {summary}
            </CardContent>
          </Card>
        ) : null}

        {topics.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-16 text-center">
              <BookOpen className="h-12 w-12 mb-4 text-muted-foreground/40" />
              <h3 className="text-lg font-semibold mb-1">No upskilling topics found</h3>
              <p className="text-sm text-muted-foreground">
                Complete another interview to generate deeper recommendations.
              </p>
              <Button
                onClick={handleCreatePlan}
                className="mt-6"
                disabled={creatingPlan}
              >
                {creatingPlan ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Generating Plan...
                  </>
                ) : (
                  "Create Upskill Plan"
                )}
              </Button>
              {createError ? (
                <p className="mt-3 text-xs text-red-500">{createError}</p>
              ) : null}
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {topics.map((topic, idx) => (
              <Card key={`${topic.skill}-${idx}`}>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between gap-3">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Target className="h-4 w-4 text-primary" /> {topic.skill}
                    </CardTitle>
                    <Badge variant="secondary">Topic {idx + 1}</Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-sm text-muted-foreground">{topic.reason}</p>
                  {topic.resources?.length ? (
                    <div className="space-y-2">
                      <p className="text-xs uppercase tracking-wide text-muted-foreground">Suggested resources</p>
                      <div className="space-y-1.5">
                        {topic.resources.map((resource, resourceIdx) => (
                          <div key={`${resource}-${resourceIdx}`} className="text-sm text-muted-foreground flex items-start gap-2">
                            <ExternalLink className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                            <span>{resource}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </main>
  )
}
