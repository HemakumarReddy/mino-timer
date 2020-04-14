import { proxy, releaseProxy, Remote } from 'comlink'
import debug from 'debug'
import * as Tone from 'tone'
import { speak } from './lib'
import { getTimerWorker } from './workers/getTimerWorker'
import { TimerWorker } from './workers/timer-worker'

const log = debug('createStore')

type CurrentRound = {
  round: RoundData | null
  exercise: ExerciseData | null
  isRecovery: boolean
}

export const createStore = () => {
  const StoreTimerWorker = getTimerWorker()
  const synth = new Tone.Synth().toMaster()
  const DEFAULT_EXERCISE_TIME = 30
  const DEFAULT_RECOVERY_TIME = 15

  return {
    newExercise: {
      id: 1,
      name: 'Squats',
      recoveryTime: DEFAULT_RECOVERY_TIME,
      recoverySecondsLeft: DEFAULT_RECOVERY_TIME,
      exerciseTime: DEFAULT_EXERCISE_TIME,
      secondsLeft: DEFAULT_EXERCISE_TIME,
      start: false,
      round: 1 as RoundId
    } as ExerciseData,
    current: {
      exercise: null,
      round: null,
      isRecovery: false
    } as CurrentRound,
    rounds: new Map<Number, RoundData>(),
    idle: false,
    changeName(name: string) {
      this.newExercise.name = name
    },
    changeDestinationRound(round: RoundId) {
      this.newExercise.round = round
    },
    clearTimers() {
      this.rounds.clear()
      this.current = {
        round: (null as unknown) as RoundData,
        exercise: (null as unknown) as ExerciseData,
        isRecovery: false
      }
    },
    stopExercise() {
      this.idle = false

      if (this.timeWorker) {
        this.timeWorker.clearInterval()
        this.timeWorker[releaseProxy]()
      }
    },
    changeExerciseTime(seconds: number) {
      this.newExercise.secondsLeft = seconds
      this.newExercise.exerciseTime = seconds
    },
    changeRecoveryTime(seconds: number) {
      this.newExercise.recoveryTime = seconds
      this.newExercise.recoverySecondsLeft = seconds
    },
    resetTimer(timer: ExerciseData) {
      this.stopExercise()
      timer.start = false
      timer.secondsLeft = timer.exerciseTime
      timer.recoverySecondsLeft = timer.recoveryTime
    },
    addExercise() {
      if (!this.rounds.has(this.newExercise.round)) {
        this.rounds.set(this.newExercise.round, {
          id: this.newExercise.round,
          exercises: [this.newExercise],
          rest: {
            recoveryTime: DEFAULT_RECOVERY_TIME,
            secondsLeft: DEFAULT_RECOVERY_TIME
          },
          repetitions: 1
        })
      } else {
        this.rounds
          .get(this.newExercise.round)!
          .exercises.push(this.newExercise)
      }

      this.newExercise = {
        ...this.newExercise,
        id: this.newExercise.id + 1
      }
    },
    updateSeconds(exercise: ExerciseData, isRecovery: boolean) {
      return proxy((secondsLeft: number) => {
        log(`Seconds left ${secondsLeft}`)
        log(`Recovery: ${isRecovery}`)

        exercise[
          isRecovery ? 'recoverySecondsLeft' : 'secondsLeft'
        ] = secondsLeft

        if (secondsLeft > 0 && secondsLeft < 4) {
          synth.triggerAttackRelease('C4', '0.2')
        }

        if (secondsLeft === 0) {
          synth.triggerAttackRelease('G4', '0.4')

          setTimeout(() => {
            this.nextExercise()
          }, 1000)
        }
      })
    },
    timeWorker: (null as unknown) as Remote<TimerWorker>,
    nextExercise() {
      if (!this.current.round) {
        throw Error('Undefined current round.')
      }
      if (!this.current.exercise) {
        throw Error('Undefined current exercise.')
      }

      if (this.current.isRecovery) {
        const index = this.current.round.exercises.findIndex(
          (item) => item === this.current.exercise
        )

        if (index < this.current.round.exercises.length - 1) {
          this.current.exercise = this.current.round.exercises[index + 1]
        } else {
          if (this.rounds.has(this.current.round.id + 1)) {
            const nextRound = this.rounds.get(this.current.round.id + 1)!
            this.current.round = nextRound
            this.current.exercise = nextRound.exercises[0]
          } else {
            speak('Congratulations! You completed your workout.')
            this.current.isRecovery = false
            this.current.exercise = null
            this.current.round = null
            this.idle = false
            return
          }
        }
      }

      this.current.isRecovery = !this.current.isRecovery

      this.startExercise()
    },
    async startExercise() {
      Tone.start()
      if (!this.rounds.size) return
      this.idle = true

      if (!this.current.round) {
        const firstRound = this.rounds.get(1)!
        this.current.round = firstRound
        this.current.exercise = firstRound.exercises[0]
      }

      this.timeWorker = await new StoreTimerWorker()

      log('Starting')
      log(`Round: ${this.current.round}`)
      log(`Exercise: ${this.current.exercise}`)

      if (!this.current.round) {
        throw Error('Undefined current round.')
      }
      if (!this.current.exercise) {
        throw Error('Undefined current exercise.')
      }

      await speak(
        this.current.isRecovery
          ? `Rest for ${this.current.exercise.recoverySecondsLeft} seconds.`
          : `Get ready for ${this.current.exercise.secondsLeft} seconds of ${this.current.exercise.name}.`
      )

      const updateSeconds = this.updateSeconds(
        this.current.exercise,
        this.current.isRecovery
      )

      await this.timeWorker.runTimer(
        this.current.exercise.exerciseTime,
        proxy((secondsLeft: number) => updateSeconds(secondsLeft))
      )
    }
  }
}

export type TStore = ReturnType<typeof createStore>
