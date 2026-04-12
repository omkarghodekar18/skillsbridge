"use client"

import { useEffect, useMemo, useState } from "react"
import { useAuth } from "@clerk/nextjs"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
  ChevronDown,
  ChevronUp,
  Lightbulb,
  TrendingUp,
  Briefcase,
  Calendar,
  MessageSquare,
  Loader2,
} from "lucide-react"

interface InterviewFeedback {
  id: string
  jobTitle: string
  date: string
  overallRating: "Strong" | "Good" | "Needs Work"
  score: number
  summary: string
  strengths: string[]
  improvements: string[]
}

interface InterviewApiItem {
  _id: string
  job_title?: string
  created_at?: string
  score?: number
  ai_evaluation?: {
    overall_score?: number
    overall_rating?: string
    summary?: string
    strengths?: string[]
    weaknesses?: string[]
  }
}

const ratingConfig = {
  Strong: { class: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400", dot: "bg-green-500" },
  Good: { class: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400", dot: "bg-blue-500" },
  "Needs Work": { class: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400", dot: "bg-red-500" },
}

function InterviewFeedbackCard({ interview }: { interview: InterviewFeedback }) {
  const [expanded, setExpanded] = useState(false)
  const rating = ratingConfig[interview.overallRating]
  const dateLabel = new Date(interview.date).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  })

  return (
    <Card className="transition-shadow hover:shadow-md">
      {/* Header — always visible */}
      <CardHeader
        className="cursor-pointer select-none"
        onClick={() => setExpanded((v) => !v)}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <Briefcase className="h-5 w-5 shrink-0 text-muted-foreground" />
            <div className="min-w-0">
              <CardTitle className="text-base truncate">{interview.jobTitle}</CardTitle>
              <CardDescription className="truncate">Interview evaluation</CardDescription>
            </div>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <span className="hidden sm:flex items-center gap-1 text-xs text-muted-foreground">
              <Calendar className="h-3 w-3" /> {dateLabel}
            </span>
            <span className="hidden sm:inline text-xs text-muted-foreground">
              Score: {interview.score}/10
            </span>
            <Badge className={`text-xs font-medium ${rating.class}`}>
              <span className={`mr-1.5 h-1.5 w-1.5 rounded-full ${rating.dot} inline-block`} />
              {interview.overallRating}
            </Badge>
            {expanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
          </div>
        </div>
      </CardHeader>

      {/* Expanded content */}
      {expanded && (
        <CardContent className="space-y-6 pt-0">
          {/* Summary */}
          <div className="rounded-lg bg-muted/40 p-4">
            <div className="flex items-center gap-2 mb-2 text-sm font-semibold">
              <MessageSquare className="h-4 w-4" />
              AI Summary
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed">{interview.summary}</p>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            {/* Strengths */}
            {interview.strengths.length > 0 ? (
              <div>
                <h4 className="mb-3 flex items-center gap-2 text-sm font-semibold text-green-600 dark:text-green-400">
                  <TrendingUp className="h-4 w-4" /> Strengths
                </h4>
                <ul className="space-y-2">
                  {interview.strengths.map((s, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                      <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-green-500 shrink-0" />
                      {s}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {/* Areas to Improve */}
            {interview.improvements.length > 0 ? (
              <div>
                <h4 className="mb-3 flex items-center gap-2 text-sm font-semibold text-amber-600 dark:text-amber-400">
                  <Lightbulb className="h-4 w-4" /> Areas to Improve
                </h4>
                <ul className="space-y-2">
                  {interview.improvements.map((s, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                      <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-amber-500 shrink-0" />
                      {s}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </CardContent>
      )}
    </Card>
  )
}

export default function AnalyticsPage() {
  const { getToken } = useAuth()
  const [items, setItems] = useState<InterviewFeedback[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true

    async function loadInterviews() {
      setLoading(true)
      setError(null)
      try {
        const token = await getToken()
        const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/interviews?limit=30`, {
          headers: { Authorization: `Bearer ${token}` },
        })

        if (!res.ok) {
          throw new Error("Failed to load analytics")
        }

        const data = await res.json()
        const mapped: InterviewFeedback[] = (data.items || []).flatMap((item: InterviewApiItem) => {
          const evalData = item.ai_evaluation
          if (!evalData || typeof evalData !== "object") {
            return []
          }

          const summary = (evalData.summary || "").trim()
          if (!summary) {
            return []
          }

          const rawScore = Number(evalData.overall_score ?? item.score ?? 0)
          if (!Number.isFinite(rawScore) || rawScore <= 0) {
            return []
          }

          const rating =
            rawScore >= 8 ? "Strong" : rawScore >= 6 ? "Good" : "Needs Work"

          return [{
            id: item._id,
            jobTitle: item.job_title || "Untitled Role",
            date: item.created_at || new Date().toISOString(),
            overallRating: (evalData.overall_rating as InterviewFeedback["overallRating"]) || rating,
            score: Math.max(0, Math.min(10, Number.isFinite(rawScore) ? rawScore : 0)),
            summary,
            strengths: Array.isArray(evalData.strengths)
              ? evalData.strengths.filter((s): s is string => typeof s === "string" && s.trim().length > 0)
              : [],
            improvements: Array.isArray(evalData.weaknesses)
              ? evalData.weaknesses.filter((s): s is string => typeof s === "string" && s.trim().length > 0)
              : [],
          }]
        })

        if (active) {
          setItems(mapped)
        }
      } catch {
        if (active) setError("Could not load interview analytics")
      } finally {
        if (active) setLoading(false)
      }
    }

    void loadInterviews()
    return () => {
      active = false
    }
  }, [getToken])

  const sortedItems = useMemo(
    () => [...items].sort((a, b) => +new Date(b.date) - +new Date(a.date)),
    [items]
  )

  return (
    <main className="min-h-screen bg-background p-8">
      <div className="mx-auto max-w-3xl">
        <div className="mb-8 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold">AI Interview Feedback</h1>
            <p className="mt-1 text-muted-foreground">
              Personalized feedback and upskilling plans from your past interviews
            </p>
          </div>
        </div>

        {loading && (
          <Card>
            <CardContent className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading interview analytics...
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

        {!loading && !error && sortedItems.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-16 text-center">
              <MessageSquare className="h-12 w-12 mb-4 text-muted-foreground/40" />
              <h3 className="text-lg font-semibold mb-1">No interviews yet</h3>
              <p className="text-sm text-muted-foreground">
                Complete a mock interview to receive AI-generated feedback and an upskilling plan.
              </p>
            </CardContent>
          </Card>
        ) : null}

        {!loading && !error && sortedItems.length > 0 ? (
          <div className="space-y-4">
            {sortedItems.map((interview) => (
              <InterviewFeedbackCard key={interview.id} interview={interview} />
            ))}
          </div>
        ) : null}
      </div>
    </main>
  )
}
