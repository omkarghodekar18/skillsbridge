"use client"

import { useEffect, useState } from "react"
import { useAuth } from "@clerk/nextjs"
import Link from "next/link"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { BookOpen, ChevronRight, Briefcase, Calendar, Loader2 } from "lucide-react"

interface PlanSummary {
  id: string
  jobTitle: string
  date: string
  skills: string[]
  overallScore: number
  topicsCount: number
  color: string
}

interface InterviewApiItem {
  _id: string
  job_title?: string
  score?: number
  created_at?: string
  ai_evaluation?: {
    overall_score?: number
    upskill_topics?: Array<{
      skill?: string
      reason?: string
      resources?: string[]
    }>
  }
}

const colorMap: Record<string, { dot: string; badge: string }> = {
  blue:   { dot: "bg-blue-500",   badge: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" },
  pink:   { dot: "bg-pink-500",   badge: "bg-pink-100 text-pink-700 dark:bg-pink-900/30 dark:text-pink-400" },
  purple: { dot: "bg-purple-500", badge: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400" },
}

export default function UpskillingListPage() {
  const { getToken } = useAuth()
  const [plans, setPlans] = useState<PlanSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true

    async function loadPlans() {
      setLoading(true)
      setError(null)
      try {
        const token = await getToken()
        const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/interviews?limit=30`, {
          headers: { Authorization: `Bearer ${token}` },
        })

        if (!res.ok) {
          throw new Error("Failed to load plans")
        }

        const data = await res.json()
        const mapped: PlanSummary[] = (data.items || [])
          .map((item: InterviewApiItem, idx: number) => {
            const topics = item.ai_evaluation?.upskill_topics || []
            const skills = topics
              .map((topic) => (topic.skill || "").trim())
              .filter(Boolean)

            if (skills.length === 0) {
              return null
            }

            return {
              id: item._id,
              jobTitle: item.job_title || "Untitled Role",
              date: item.created_at || new Date().toISOString(),
              skills,
              overallScore: Number(item.ai_evaluation?.overall_score ?? item.score ?? 0),
              topicsCount: topics.length,
              color: ["blue", "pink", "purple"][idx % 3],
            }
          })
          .filter((item: PlanSummary | null): item is PlanSummary => item !== null)

        if (active) {
          setPlans(mapped)
        }
      } catch {
        if (active) setError("Could not load upskilling plans")
      } finally {
        if (active) setLoading(false)
      }
    }

    void loadPlans()

    return () => {
      active = false
    }
  }, [getToken])

  return (
    <main className="min-h-screen bg-background p-8">
      <div className="mx-auto max-w-3xl">
        <div className="mb-8">
          <h1 className="text-3xl font-bold">Upskilling Plans</h1>
          <p className="mt-1 text-muted-foreground">
            Personalized learning plans generated from each past interview
          </p>
        </div>

        {loading && (
          <Card>
            <CardContent className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading upskilling plans...
            </CardContent>
          </Card>
        )}

        {error && !loading && (
          <Card>
            <CardContent className="py-16 text-center text-sm text-red-500">
              {error}
            </CardContent>
          </Card>
        )}

        {!loading && !error && plans.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-16 text-center">
              <BookOpen className="h-12 w-12 mb-4 text-muted-foreground/40" />
              <h3 className="text-lg font-semibold mb-1">No plans yet</h3>
              <p className="text-sm text-muted-foreground">
                Complete a mock interview to get a personalized upskilling plan.
              </p>
            </CardContent>
          </Card>
        ) : null}

        {!loading && !error && plans.length > 0 ? (
          <div className="space-y-4">
            {plans.map((plan) => {
              const c = colorMap[plan.color]
              const normalizedScore = Math.max(0, Math.min(10, Number.isFinite(plan.overallScore) ? plan.overallScore : 0))
              const pct = Math.round((normalizedScore / 10) * 100)
              const dateLabel = new Date(plan.date).toLocaleDateString("en-IN", {
                day: "numeric", month: "short", year: "numeric",
              })

              return (
                <Link key={plan.id} href={`/dashboard/upskilling/${plan.id}`} className="block group">
                  <Card className="transition-all duration-200 hover:shadow-md hover:border-primary/30">
                    <CardHeader className="pb-3">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex items-center gap-3 min-w-0">
                          <Briefcase className="h-5 w-5 shrink-0 text-muted-foreground" />
                          <div className="min-w-0">
                            <CardTitle className="text-base">{plan.jobTitle}</CardTitle>
                            <CardDescription>Interview-based learning plan</CardDescription>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="hidden sm:flex items-center gap-1 text-xs text-muted-foreground">
                            <Calendar className="h-3 w-3" /> {dateLabel}
                          </span>
                          <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:translate-x-0.5 transition-transform" />
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {/* Skills */}
                      <div className="flex flex-wrap gap-2">
                        {plan.skills.map((s) => (
                          <Badge key={s} className={`text-xs ${c.badge}`}>
                            <span className={`mr-1.5 h-1.5 w-1.5 rounded-full ${c.dot} inline-block`} />
                            {s}
                          </Badge>
                        ))}
                      </div>
                      {/* Progress */}
                      <div className="flex items-center gap-3">
                        <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                          <div
                            className="h-full rounded-full bg-primary transition-all"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <span className="text-xs text-muted-foreground shrink-0">
                          Score {normalizedScore.toFixed(1)}/10 · {plan.topicsCount} topics
                        </span>
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              )
            })}
          </div>
        ) : null}
      </div>
    </main>
  )
}
