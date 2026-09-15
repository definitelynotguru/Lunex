export const DEMOS = {
  fibonacci: `; Fibonacci Sequence
; Outputs first 15 Fibonacci numbers
; Uses A=prev, B=current, C=counter, D=temp
;
  LDI A, 0            ; prev = 0
  LDI B, 1            ; current = 1
  LDI C, 15           ; countdown counter

loop:
  MOV D, A            ; D = prev (save)
  MOV A, B            ; A = current (for output)
  INT 0x01            ; print current as decimal
  MOV A, D            ; A = prev (restore)
  MOV D, B            ; D = current (save before modifying B)
  ADD B, A            ; B = current + prev (next fib)
  MOV A, D            ; A = old current (new prev for next iteration)
  DEC C               ; counter--
  JNZ loop            ; continue until counter == 0
  HLT                 ; done`,

  bubble: `; Bubble Sort
; Sorts a 4-byte array in memory (ascending order)
; Array stored at addresses 0xC0-0xC3
;
  ; Initialize array: 4, 2, 3, 1
  LDI A, 4
  STA [0xC0], A
  LDI A, 2
  STA [0xC1], A
  LDI A, 3
  STA [0xC2], A
  LDI A, 1
  STA [0xC3], A

  ; C = swapped flag, D = inner index
  LDI C, 1            ; swapped = 1 (force first pass)

outer:
  MOV A, C            ; check if previous pass swapped
  LDI C, 0            ; reset swapped = 0
  LDI D, 0            ; inner index = 0

inner:
  ; Check if inner index < 3
  LDI A, 3
  CMP D, A
  JZ chks             ; inner index == 3, check if swapped

  ; Load arr[D] and arr[D+1]
  LDI A, 0xC0
  ADD A, D            ; A = &arr[D]
  LDR B, [A]          ; B = arr[D]
  INC A               ; A = &arr[D+1]
  PUSH D              ; save inner index
  LDR D, [A]          ; D = arr[D+1]

  ; Compare: if B < D (arr[D] < arr[D+1]), already sorted
  CMP B, D
  JC skip             ; carry = B < D, no swap needed
  JZ skip             ; zero = B == D, no swap needed

  ; Swap: B=max, D=min, A=&arr[D+1]
  STR [A], B          ; arr[D+1] = max (B)
  DEC A
  MOV B, D            ; B = min
  STR [A], B          ; arr[D] = min
  POP D               ; restore index
  INC C               ; swapped = 1
  INC D
  JMP inner

skip:
  POP D               ; restore index
  INC D
  JMP inner

chks:
  MOV A, C            ; check swapped flag
  LDI D, 0
  LDI B, 0
  CMP A, B            ; if swapped == 0, done
  JNZ outer           ; otherwise do another pass

done:
  ; Output sorted array
  LDI D, 0
out:
  LDI A, 0xC0
  ADD A, D
  LDR A, [A]          ; load value into A for INT output
  INT 0x01
  INC D
  LDI A, 4
  CMP D, A
  JNZ out
  HLT`,

  reverse: `; String Reverse
; Reverses "HELLO" using the stack
; Pushes each character, then pops to output
;
  ; Push characters onto stack in order
  LDI A, 72           ; 'H'
  PUSH A
  LDI A, 69           ; 'E'
  PUSH A
  LDI A, 76           ; 'L'
  PUSH A
  LDI A, 76           ; 'L'
  PUSH A
  LDI A, 79           ; 'O'
  PUSH A

  ; Pop and output in reverse order
  LDI B, 5            ; counter = 5

out:
  POP A               ; pop top of stack
  INT 0x02            ; print as character
  DEC B               ; counter--
  JNZ out             ; continue if counter != 0
  HLT`,

  countdown: `; Countdown Timer
; Counts down from 10 to 1, outputs each value
;
  LDI A, 10           ; start value
  LDI C, 0            ; zero for comparison

count:
  INT 0x01            ; output A as decimal
  DEC A               ; A = A - 1
  CMP A, C            ; compare with 0
  JNZ count           ; continue until A == 0
  HLT                 ; done`
};
