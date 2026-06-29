"use client"

import { useEffect, useRef, useState, useCallback } from "react"
import { useParams, useSearchParams } from "next/navigation"
import { useAuth } from "@clerk/nextjs"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Mic,
  MicOff,
  ChevronRight,
  RotateCcw,
  CheckCircle2,
  Home,
  Loader2,
  StopCircle,
} from "lucide-react"
import Link from "next/link"

function InterviewAvatarCard({ isSpeaking }: { isSpeaking: boolean }) {
  return (
    <div className="w-full rounded-2xl border border-slate-700 bg-gradient-to-b from-slate-900 to-slate-800 p-10 text-center shadow-2xl">
      <div className="mx-auto mb-3 flex h-20 w-20 items-center justify-center rounded-full bg-indigo-500/15 text-4xl">
        🤖
      </div>
      <p className="text-sm font-medium text-slate-100">AI Interviewer</p>
      <p className="mt-1 text-xs text-slate-300">
        {isSpeaking ? "Speaking..." : "Listening..."}
      </p>
    </div>
  )
}

type Phase = "intro" | "ai-speaking" | "user-answering" | "done"

interface Answer {
  question: string
  transcript: string
}

interface InterviewEvaluation {
  overall_score: number
  overall_rating: string
  summary: string
  per_question: Array<{
    question: string
    answer: string
    score: number
    feedback: string
  }>
  strengths: string[]
  weaknesses: string[]
  upskill_topics: Array<{
    skill: string
    reason: string
    resources: string[]
  }>
}

export default function InterviewSessionPage() {
  const params = useParams()
  const searchParams = useSearchParams()
  const jobTitle = searchParams.get("title") || ""
  const { getToken } = useAuth()

  const [questions, setQuestions] = useState<string[]>([])
  const [loadingQuestions, setLoadingQuestions] = useState(true)
  const [questionError, setQuestionError] = useState<string | null>(null)
  const [phase, setPhase] = useState<Phase>("intro")
  const [questionIndex, setQuestionIndex] = useState(0)
  const [transcript, setTranscript] = useState("")
  const [isMuted, setIsMuted] = useState(false)
  const [answers, setAnswers] = useState<Answer[]>([])
  const [avatarSpeaking, setAvatarSpeaking] = useState(false)
  const [isRecording, setIsRecording] = useState(false)
  const [isTranscribing, setIsTranscribing] = useState(false)
  const [isSavingInterview, setIsSavingInterview] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [recordingError, setRecordingError] = useState<string | null>(null)
  const [transcribeError, setTranscribeError] = useState<string | null>(null)
  const [finalEvaluation, setFinalEvaluation] = useState<InterviewEvaluation | null>(null)
  const [savedInterviewId, setSavedInterviewId] = useState<string | null>(null)

  const audioCtxRef = useRef<AudioContext | null>(null)
  const sourceRef = useRef<AudioBufferSourceNode | null>(null)
  // MediaRecorder refs
  const mediaRecRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const streamRef = useRef<MediaStream | null>(null)
  // Mirrors `transcript` so handleNext can read the live typed value synchronously
  const transcriptRef = useRef<string>("")

  // ─── Fetch AI questions on mount ───────────────────────────────────────────
  useEffect(() => {
    let mounted = true
    async function initQuestions() {
      try {
        setQuestionError(null)
        const token = await getToken()
        const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/ask`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${token}`
          },
          body: JSON.stringify({ job_id: params.id })
        })
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}))
          throw new Error(errData.message || errData.error || `Failed to fetch questions: ${res.status}`)
        }
        const data = await res.json()
        const generated = data.questions
        if (!Array.isArray(generated) || generated.length === 0) {
          throw new Error("No interview questions were generated")
        }
        if (mounted) {
          setQuestions(generated)
        }
      } catch (err) {
        if (mounted) {
          const msg = err instanceof Error ? err.message : "Failed to generate interview questions"
          setQuestionError(msg)
          setQuestions([])
        }
      } finally {
        if (mounted) setLoadingQuestions(false)
      }
    }
    if (params.id) initQuestions()
    return () => { mounted = false }
  }, [params.id, getToken])

  // ─── TTS via edge-tts backend ──────────────────────────────────────────────
  const speak = useCallback(async (text: string, onEnd?: () => void) => {
    sourceRef.current?.stop()

    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/tts/speak`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      })
      if (!res.ok) throw new Error(`TTS backend returned ${res.status}`)

      const audioData = await res.arrayBuffer()

      if (!audioCtxRef.current) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)()
      }
      const ctx = audioCtxRef.current
      const audioBuffer = await ctx.decodeAudioData(audioData)

      const source = ctx.createBufferSource()
      source.buffer = audioBuffer
      source.connect(ctx.destination)
      sourceRef.current = source

      setAvatarSpeaking(true)
      source.start()
      source.onended = () => {
        setAvatarSpeaking(false)
        onEnd?.()
      }
    } catch {
      setAvatarSpeaking(false)
      onEnd?.()
    }
  }, [])

  // ─── MediaRecorder: start capturing mic audio ──────────────────────────────
  const startRecording = useCallback(async () => {
    setRecordingError(null)
    chunksRef.current = []

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          noiseSuppression: true,
          echoCancellation: true,
          autoGainControl: true,
        },
      })
      streamRef.current = stream

      // Prefer WebM (Chrome) → OGG (Firefox) → default
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/ogg;codecs=opus")
          ? "audio/ogg;codecs=opus"
          : ""

      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
      mediaRecRef.current = recorder

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }

      // Collect chunks every second so we don't lose data on abrupt stops
      recorder.start(1000)
      setIsRecording(true)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes("Permission") || msg.includes("denied") || msg.includes("NotAllowed")) {
        setRecordingError("Microphone access denied. Please allow mic permission, or type your answer below.")
      } else {
        setRecordingError("Could not access microphone. Please type your answer below.")
      }
    }
  }, [])

  // ─── Stop recording and send to Faster-Whisper backend ────────────────────
  const stopAndTranscribe = useCallback((): Promise<string> => {
    return new Promise((resolve) => {
      const recorder = mediaRecRef.current

      // Stop all mic tracks
      streamRef.current?.getTracks().forEach((t) => t.stop())
      streamRef.current = null
      setIsRecording(false)

      if (!recorder || recorder.state === "inactive") {
        // Nothing to transcribe — return whatever was typed manually
        resolve(transcriptRef.current)
        return
      }

      recorder.onstop = async () => {
        mediaRecRef.current = null
        const chunks = chunksRef.current
        chunksRef.current = []

        if (chunks.length === 0) {
          resolve(transcriptRef.current)
          return
        }

        setIsTranscribing(true)
        setTranscribeError(null)
        try {
          const blob = new Blob(chunks, { type: chunks[0].type || "audio/webm" })
          const form = new FormData()
          const mime = (blob.type || "").toLowerCase()
          const filename = mime.includes("ogg")
            ? "recording.ogg"
            : mime.includes("wav")
              ? "recording.wav"
              : mime.includes("mp4") || mime.includes("m4a")
                ? "recording.m4a"
                : "recording.webm"
          form.append("audio", blob, filename)

          const res = await fetch(
            `${process.env.NEXT_PUBLIC_API_URL}/api/stt/transcribe`,
            { method: "POST", body: form }
          )

          if (!res.ok) {
            const errData = await res.json().catch(() => ({}))
            throw new Error(errData.error || `STT backend returned ${res.status}`)
          }

          const data = await res.json()
          const sttText = (data.transcript || "").trim()

          // Merge STT result with any manually typed text
          const typed = transcriptRef.current.trim()
          const merged = sttText
            ? typed
              ? `${sttText} ${typed}`
              : sttText
            : typed

          transcriptRef.current = merged
          setTranscript(merged)
          resolve(merged)
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          console.error("Transcription error:", msg)
          setTranscribeError(msg)
          // STT failed — fall back to whatever was typed
          resolve(transcriptRef.current)
        } finally {
          setIsTranscribing(false)
        }
      }

      recorder.stop()
    })
  }, [])

  // ─── Interview flow helpers ────────────────────────────────────────────────
  const askQuestion = useCallback(
    (index: number) => {
      setPhase("ai-speaking")
      setTranscript("")
      transcriptRef.current = ""
      setRecordingError(null)
      speak(questions[index], () => {
        setPhase("user-answering")
        startRecording()
      })
    },
    [speak, startRecording, questions]
  )

  const startInterview = () => {
    setQuestionIndex(0)
    setAnswers([])
    setSaveError(null)
    setFinalEvaluation(null)
    setSavedInterviewId(null)
    askQuestion(0)
  }

  const persistInterview = useCallback(async (finalAnswers: Answer[]) => {
    setSaveError(null)
    setIsSavingInterview(true)
    try {
      const apiBase = process.env.NEXT_PUBLIC_API_URL
      const questionList = finalAnswers.map((a) => a.question)
      const answerList = finalAnswers.map((a) => a.transcript)

      let evaluation: InterviewEvaluation | null = null

      try {
        // Fetch a fresh token right before the evaluation call
        const evalToken = await getToken()
        const evalRes = await fetch(`${apiBase}/api/evaluate-interview`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${evalToken}`,
          },
          body: JSON.stringify({
            job_id: String(params.id),
            job_title: jobTitle,
            questions: questionList,
            answers: answerList,
          }),
        })

        if (evalRes.ok) {
          evaluation = (await evalRes.json()) as InterviewEvaluation
        }
      } catch {
        evaluation = null
      }

      // Fetch a fresh token before saving — the evaluation call above may
      // have taken long enough for the previous token to expire.
      const saveToken = await getToken()
      const saveRes = await fetch(`${apiBase}/api/interviews`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${saveToken}`,
        },
        body: JSON.stringify({
          job_id: String(params.id),
          job_title: jobTitle,
          questions: questionList,
          answers: answerList,
          ai_evaluation: evaluation,
        }),
      })

      if (!saveRes.ok) {
        const errData = await saveRes.json().catch(() => ({}))
        throw new Error(
          errData?.message || errData?.error || "Could not save interview results"
        )
      }

      const savedData = await saveRes.json()
      const savedItem = savedData?.item
      if (savedItem?._id) {
        setSavedInterviewId(String(savedItem._id))
      }

      const savedEval = savedItem?.ai_evaluation as InterviewEvaluation | undefined
      if (savedEval && typeof savedEval === "object") {
        setFinalEvaluation(savedEval)
      } else {
        setFinalEvaluation(evaluation)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Interview finished, but saving failed."
      setSaveError(msg)
    } finally {
      setIsSavingInterview(false)
    }
  }, [getToken, params.id])

  const handleNext = async () => {
    // Stop mic and wait for transcript from backend
    const finalTranscript = await stopAndTranscribe()

    const current: Answer = {
      question: questions[questionIndex],
      transcript: finalTranscript.trim() || "(no answer recorded)",
    }
    const updated = [...answers, current]
    setAnswers(updated)

    if (questionIndex + 1 >= questions.length) {
      void persistInterview(updated)
      setPhase("done")
    } else {
      const next = questionIndex + 1
      setQuestionIndex(next)
      askQuestion(next)
    }
  }

  const handleEndInterview = async () => {
    // Stop recording and transcribe current answer
    const finalTranscript = await stopAndTranscribe()

    // Save current answer if user was in the middle of answering
    const current: Answer = {
      question: questions[questionIndex],
      transcript: finalTranscript.trim() || "(no answer recorded)",
    }
    const updated = [...answers, current]
    setAnswers(updated)

    // Persist only the attempted questions and move to done
    void persistInterview(updated)
    setPhase("done")
  }

  const toggleMute = () => {
    setIsMuted((m) => {
      if (!m) {
        // Muting — pause the recorder (keeps stream open but stops collecting)
        if (mediaRecRef.current?.state === "recording") {
          mediaRecRef.current.pause()
        }
      } else {
        // Unmuting — resume if we were recording
        if (mediaRecRef.current?.state === "paused") {
          mediaRecRef.current.resume()
        } else if (phase === "user-answering") {
          startRecording()
        }
      }
      return !m
    })
  }

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      window.speechSynthesis?.cancel()
      streamRef.current?.getTracks().forEach((t) => t.stop())
      mediaRecRef.current?.stop()
    }
  }, [])

  const progress = Math.round(((questionIndex + (phase === "done" ? 0 : 0)) / Math.max(1, questions.length)) * 100)
  const difficultyLabel = questionIndex < 25 ? "Easy" : questionIndex < 50 ? "Medium" : questionIndex < 75 ? "Hard" : "Expert"

  // ─── Done phase ────────────────────────────────────────────────────────────
  if (phase === "done") {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-background p-8">
        <div className="w-full max-w-2xl space-y-6">
          <div className="text-center space-y-2">
            <CheckCircle2 className="mx-auto h-14 w-14 text-green-500" />
            <h1 className="text-3xl font-bold">Interview Complete!</h1>
            <p className="text-muted-foreground">Great job! You answered {answers.length} out of {questions.length} questions.</p>
            {isSavingInterview && (
              <p className="text-sm text-muted-foreground">Saving results and generating AI feedback...</p>
            )}
            {saveError && (
              <p className="text-sm text-red-500">{saveError}</p>
            )}
          </div>

          {finalEvaluation && (
            <div className="rounded-xl border bg-card p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">AI Evaluation</p>
                  <p className="text-sm text-muted-foreground">{finalEvaluation.summary || "Interview evaluated using Gemini AI."}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-muted-foreground">Overall Score</p>
                  <p className="text-2xl font-bold">{finalEvaluation.overall_score}/10</p>
                  <Badge variant="secondary" className="mt-1">{finalEvaluation.overall_rating || "Good"}</Badge>
                </div>
              </div>
            </div>
          )}

          <div className="space-y-4 rounded-xl border bg-card p-6 max-h-[60vh] overflow-y-auto">
            {answers.map((a, i) => (
              <div key={i} className="space-y-1 border-b pb-4 last:border-0 last:pb-0">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Q{i + 1}</p>
                <p className="font-medium">{a.question}</p>
                <p className="text-sm text-muted-foreground leading-relaxed">{a.transcript}</p>
              </div>
            ))}
          </div>

          <div className="flex gap-3 justify-center">
            <Button variant="outline" onClick={startInterview} className="gap-2">
              <RotateCcw className="h-4 w-4" /> Retry
            </Button>
            {savedInterviewId && (
              <Button asChild variant="outline" className="gap-2">
                <Link href={`/dashboard/upskilling/${savedInterviewId}`}>
                  {finalEvaluation?.upskill_topics?.length ? "View Upskill Plan" : "Create Upskill Plan"}
                </Link>
              </Button>
            )}
            <Button asChild className="gap-2">
              <Link href="/dashboard/interviews">
                <Home className="h-4 w-4" /> Back to Interviews
              </Link>
            </Button>
          </div>
        </div>
      </div>
    )
  }

  // ─── Intro phase ───────────────────────────────────────────────────────────
  if (phase === "intro") {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-background p-8">
        <div className="w-full max-w-lg text-center space-y-8">
          <InterviewAvatarCard isSpeaking={false} />

          <div className="space-y-3">
            <h1 className="text-3xl font-bold bg-gradient-to-r from-blue-500 via-indigo-500 to-purple-500 bg-clip-text text-transparent">
              AI Mock Interview
            </h1>
            <p className="text-muted-foreground">
              {loadingQuestions ? (
                "Analyzing your resume and job description to generate a comprehensive question bank. This may take a moment..."
              ) : questionError ? (
                `Question generation failed: ${questionError}`
              ) : (
                `${questions.length} questions prepared — starting easy and getting progressively harder. End the interview whenever you feel ready. Only your attempted answers will be evaluated.`
              )}
            </p>
            <div className="flex justify-center flex-wrap gap-2">
              <Badge variant="secondary">🎙 Voice answers</Badge>
              <Badge variant="secondary">📝 Live transcript</Badge>
              <Badge variant="secondary">📈 Easy → Expert</Badge>
              <Badge variant="secondary">🛑 End anytime</Badge>
            </div>
          </div>

          <Button
            size="lg"
            onClick={startInterview}
            disabled={loadingQuestions || !!questionError || questions.length === 0}
            className="gap-2 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white px-10 disabled:opacity-80"
          >
            {loadingQuestions ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Generating Questions…
              </>
            ) : questionError ? (
              <>Unable to Start Interview</>
            ) : (
              <>
                Start Interview <ChevronRight className="h-4 w-4" />
              </>
            )}
          </Button>
        </div>
      </div>
    )
  }

  // ─── Interview phase ───────────────────────────────────────────────────────
  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* Top bar */}
      <div className="flex items-center justify-between px-6 pt-5 pb-3">
        <Link
          href="/dashboard/interviews"
          className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          onClick={() => {
            window.speechSynthesis?.cancel()
            streamRef.current?.getTracks().forEach((t) => t.stop())
            mediaRecRef.current?.stop()
          }}
        >
          ← Back
        </Link>
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground">
            Q {questionIndex + 1} / {questions.length}
          </span>
          <Badge
            variant="outline"
            className="text-xs"
          >
            {difficultyLabel}
          </Badge>
          <Badge
            variant={phase === "ai-speaking" ? "default" : "secondary"}
            className="text-xs"
          >
            {phase === "ai-speaking" ? "🔊 AI Speaking…" : "🎙 Your Turn"}
          </Badge>
        </div>
      </div>

      {/* Progress bar */}
      <div className="px-6">
        <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
          <div
            className="h-full rounded-full bg-gradient-to-r from-blue-500 via-indigo-500 to-purple-500 transition-all duration-700"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {/* Main layout */}
      <div className="flex flex-1 flex-col items-center gap-5 p-4 max-w-2xl mx-auto w-full">

        {/* Avatar */}
        <InterviewAvatarCard isSpeaking={avatarSpeaking} />

        {/* Speaking wave indicator */}
        {avatarSpeaking && (
          <div className="flex items-end gap-1 h-5">
            {[2, 4, 6, 8, 6, 4, 2].map((h, i) => (
              <div
                key={i}
                className="w-1.5 rounded-full bg-indigo-500 animate-pulse"
                style={{ height: `${h * 3}px`, animationDelay: `${i * 70}ms` }}
              />
            ))}
            <span className="text-xs text-indigo-400 ml-2 self-center">Speaking…</span>
          </div>
        )}

        {/* Question card */}
        <div className="w-full rounded-2xl border bg-card p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-2">
            {phase === "ai-speaking" ? "Question" : "Speak your answer…"}
          </p>
          <p className="text-lg font-semibold leading-snug">
            {questions[questionIndex]}
          </p>
        </div>


        {/* Errors */}
        {(recordingError || transcribeError) && (
          <div className="w-full rounded-lg border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-500">
            {recordingError && <p>🎙️ {recordingError}</p>}
            {transcribeError && <p>⚙️ {transcribeError}</p>}
          </div>
        )}

        {/* Controls */}
        <div className="flex w-full items-center gap-4">
          <Button
            variant="outline"
            size="icon"
            className="h-12 w-12 rounded-full shrink-0"
            onClick={toggleMute}
            disabled={phase !== "user-answering"}
            title={isMuted ? "Unmute" : "Mute"}
          >
            {isMuted
              ? <MicOff className="h-5 w-5 text-red-500" />
              : <Mic className={`h-5 w-5 ${isRecording ? "text-green-500" : ""}`} />}
          </Button>

          <Button
            size="lg"
            className="flex-1 gap-2 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white"
            onClick={handleNext}
            disabled={phase === "ai-speaking" || isTranscribing}
          >
            {isTranscribing ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Transcribing…
              </>
            ) : questionIndex + 1 === questions.length ? (
              <>Finish Interview <ChevronRight className="h-4 w-4" /></>
            ) : (
              <>Next Question <ChevronRight className="h-4 w-4" /></>
            )}
          </Button>

          {/* End Interview early button */}
          {questionIndex + 1 < questions.length && (
            <Button
              variant="outline"
              size="icon"
              className="h-12 w-12 rounded-full shrink-0 border-red-500/50 text-red-500 hover:bg-red-500/10 hover:text-red-600"
              onClick={handleEndInterview}
              disabled={phase === "ai-speaking" || isTranscribing}
              title="End Interview"
            >
              <StopCircle className="h-5 w-5" />
            </Button>
          )}
        </div>

        <p className="text-xs text-muted-foreground text-center -mt-2">
          {isTranscribing
            ? "⏳ Processing your answer…"
            : isRecording && !isMuted
              ? "🔴 Recording — click Next when done"
              : phase === "ai-speaking"
                ? "🔊 AI is speaking, please wait"
                : "—"}
        </p>
      </div>
    </div>
  )
}
