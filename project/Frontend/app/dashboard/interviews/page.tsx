"use client"

import { useEffect, useState } from "react"
import { useAuth } from "@clerk/nextjs"
import Link from "next/link"
import {
  Card,
  CardContent,
} from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Briefcase,
  Building2,
  MapPin,
  FileUp,
  Loader2,
  TrendingUp,
  Clock,
  PlayCircle,
} from "lucide-react"

const API_BASE = process.env.NEXT_PUBLIC_API_URL

interface Job {
  job_id: string
  title: string
  company: string
  location: string
  country: string
  description: string
  apply_link: string
  employment_type: string
  posted_at: string
  match_score: number
  missing_skills?: string[]
}

export default function InterviewsPage() {
  const { getToken } = useAuth()
  const [loading, setLoading] = useState(true)
  const [hasResume, setHasResume] = useState(false)
  const [jobs, setJobs] = useState<Job[]>([])
  const [error, setError] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)

  const fetchJobs = async (pageNum = 1) => {
    try {
      if (pageNum === 1) setLoading(true)
      else setLoadingMore(true)

      const token = await getToken()
      const res = await fetch(`${API_BASE}/api/jobs?page=${pageNum}&limit=10`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) throw new Error("Failed to load jobs")
      const data = await res.json()

      setHasResume(data.has_resume)
      if (pageNum === 1) {
        setJobs(data.jobs || [])
      } else {
        setJobs((prev) => [...prev, ...(data.jobs || [])])
      }
      setHasMore(data.has_more || false)
      setPage(pageNum)
    } catch {
      setError("Could not load interviews")
    } finally {
      if (pageNum === 1) setLoading(false)
      setLoadingMore(false)
    }
  }

  useEffect(() => {
    fetchJobs(1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Loading ───────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  // ── Error ─────────────────────────────────────────────────────────────────
  if (error) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <p className="text-muted-foreground">{error}</p>
      </div>
    )
  }

  // ── No resume ─────────────────────────────────────────────────────────────
  if (!hasResume) {
    return (
      <div className="min-h-screen bg-background p-8">
        <div className="mx-auto max-w-3xl">
          <div className="mb-8">
            <h1 className="bg-gradient-to-r from-blue-600 via-purple-600 to-pink-600 bg-clip-text text-3xl font-bold tracking-tight text-transparent">
              Interview Prep
            </h1>
            <p className="text-muted-foreground">
              Practice AI-powered mock interviews tailored to your matched jobs
            </p>
          </div>

          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center justify-center py-16 text-center">
              <div className="mb-4 rounded-full bg-primary/10 p-4">
                <FileUp className="h-10 w-10 text-primary" />
              </div>
              <h2 className="mb-2 text-xl font-semibold">Upload Your Resume First</h2>
              <p className="mb-6 max-w-md text-sm text-muted-foreground">
                To get job-specific interview questions, upload your resume so we can match
                you with the best opportunities.
              </p>
              <Button asChild>
                <Link href="/dashboard/profile">
                  <FileUp className="mr-2 h-4 w-4" />
                  Go to Profile &amp; Upload Resume
                </Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    )
  }

  // ── Job list ──────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-background p-8">
      <div className="mx-auto max-w-5xl">
        {/* Header */}
        <div className="mb-8">
          <h1 className="bg-gradient-to-r from-blue-600 via-purple-600 to-pink-600 bg-clip-text text-3xl font-bold tracking-tight text-transparent">
            Interview Prep
          </h1>
          <p className="text-muted-foreground">
            Practice mock interviews for your top {jobs.length} matched jobs
          </p>
        </div>

        {jobs.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-16 text-center">
              <Briefcase className="mb-4 h-10 w-10 text-muted-foreground" />
              <h2 className="mb-2 text-lg font-semibold">No Matched Jobs Yet</h2>
              <p className="text-sm text-muted-foreground">
                We're fetching fresh jobs. Check back soon!
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {jobs.map((job, index) => (
              <Card
                key={job.job_id}
                className="group transition-all duration-200 hover:shadow-lg hover:border-primary/30"
              >
                <CardContent className="p-6">
                  <div className="flex items-start justify-between gap-4">
                    {/* Left – Job info */}
                    <div className="min-w-0 flex-1 space-y-3">
                      <div className="flex items-start gap-3">
                        {/* Rank badge */}
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border bg-muted text-xs font-bold text-foreground">
                          {index + 1}
                        </div>

                        <div className="min-w-0">
                          <h3 className="text-lg font-semibold leading-tight">
                            {job.title || "Untitled Position"}
                          </h3>

                          <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                            {job.company && (
                              <span className="flex items-center gap-1">
                                <Building2 className="h-3.5 w-3.5" />
                                {job.company}
                              </span>
                            )}
                            {job.location && (
                              <span className="flex items-center gap-1">
                                <MapPin className="h-3.5 w-3.5" />
                                {job.location}
                                {job.country ? `, ${job.country}` : ""}
                              </span>
                            )}
                            {job.posted_at && (
                              <span className="flex items-center gap-1">
                                <Clock className="h-3.5 w-3.5" />
                                {new Date(job.posted_at).toLocaleDateString("en-US", {
                                  month: "short",
                                  day: "numeric",
                                })}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Description snippet */}
                      {job.description && (
                        <p className="line-clamp-2 text-sm leading-relaxed text-muted-foreground pl-11">
                          {job.description}
                        </p>
                      )}

                      {/* Tags and Skills Gap */}
                      <div className="flex flex-col gap-3 pl-11">
                        <div className="flex flex-wrap items-center gap-2">
                          {job.employment_type && (
                            <Badge variant="secondary" className="text-xs">
                              {job.employment_type.replace(/_/g, " ")}
                            </Badge>
                          )}
                          <Badge
                            className="gap-1 text-xs bg-gradient-to-r from-green-500/10 to-emerald-500/10 text-green-700 dark:text-green-400 border-green-500/20"
                            variant="outline"
                          >
                            <TrendingUp className="h-3 w-3" />
                            {job.match_score}% match
                          </Badge>
                        </div>

                        {job.missing_skills && job.missing_skills.length > 0 && (
                          <div className="space-y-1.5">
                            <p className="text-xs font-medium text-muted-foreground">
                              Skills to add to improve match:
                            </p>
                            <div className="flex flex-wrap gap-1.5">
                              {job.missing_skills.map((skill, i) => (
                                <Badge
                                  key={i}
                                  variant="outline"
                                  className="text-[10px] bg-orange-500/10 text-orange-700 dark:text-orange-400 border-orange-500/20 shadow-sm transition-colors hover:bg-orange-500/20"
                                >
                                  + {skill}
                                </Badge>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Right – Start Interview button */}
                    <div className="shrink-0">
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-2 border-violet-500/50 text-violet-600 hover:bg-violet-500/10 hover:text-violet-700 dark:border-violet-400/50 dark:text-violet-400 dark:hover:bg-violet-400/10 dark:hover:text-violet-300 shadow-sm"
                        asChild
                      >
                        <Link href={`/dashboard/interviews/${job.job_id}?title=${encodeURIComponent(job.title || "")}`}>
                          <PlayCircle className="h-3.5 w-3.5" />
                          Start Interview
                        </Link>
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Load More */}
        {jobs.length > 0 && hasMore && (
          <div className="mt-8 flex justify-center">
            <Button
              variant="outline"
              size="lg"
              className="gap-2 border-primary/20 hover:bg-primary/5 cursor-pointer"
              onClick={() => fetchJobs(page + 1)}
              disabled={loadingMore}
            >
              {loadingMore ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading more jobs...
                </>
              ) : (
                "Load More"
              )}
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
