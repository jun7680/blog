+++
author = "오깅중"
title = "Swift ClosedRange<Date> 한 줄 때문에 한 달간 헤맨 이야기"
slug = "closed-range-date-crash"
date = "2026-05-26T10:30:00+09:00"
description = "Swift ClosedRange<Date>의 precondition trap을 따라가다 보니, 진짜 범인은 캘린더 데이터 매핑에서 가드 변수를 안 쓴 한 줄이었다. 데이터·표현 두 레이어로 막은 회고."
categories = ["Swift"]
tags = ["Swift", "ClosedRange", "Date", "Crash", "EXC_BREAKPOINT", "Debugging", "Crashlytics"]
image = ""
+++

## 도입

어느 날 Crashlytics를 열었더니 캘린더 화면 한 곳에서만 4주간 98건이 쌓여 있었다. 신호는 `EXC_BREAKPOINT`. 영향 사용자는 15명. 같은 사용자가 평균 9~10번씩 죽는 `SIGNAL_REPETITIVE` 패턴.

스택은 단순했다.

```
at closure #1 in CalendarViewModel.filter(date:)
at CalendarViewModel.filter(date:) (CalendarViewModel.swift:177)
```

문제의 한 줄.

```swift
snippet.start.startOfDay()...snippet.end.addingTimeInterval(-1) ~= date
```

## ClosedRange의 precondition 강제

Swift 표준 라이브러리의 `ClosedRange.init(uncheckedBounds:)`가 아니라 `lower...upper` 슈가를 쓰면, 컴파일러는 `Range._precondition(lower <= upper)`를 함께 호출한다. `lower > upper`면 즉시 trap. iOS 런타임에선 `EXC_BREAKPOINT`로 죽는다.

이게 평소엔 안 보인다. `startOfDay()` / `endOfDay()`처럼 보장된 함수로 만들면 안전하다. 문제는 **사용자/서버 데이터가 들어오는 순간**이다.

```swift
// 안전한 케이스
date.startOfDay()...date.endOfDay()  // 같은 날짜, 항상 lower <= upper

// 위험한 케이스
snippet.start.startOfDay()...snippet.end.addingTimeInterval(-1)
// snippet.end 가 snippet.start 보다 빠르면? → 죽는다
```

## 한참 더 깊었던 Root cause

크래시 지점은 표면이었다. 진짜 원인은 데이터 매핑 단계에 있었다.

```swift
// CalendarManager.buildSnippets
let dtEnd = event.dtEnd.isValid ? event.dtEnd : event.dtStart

// ... 한참 후 ...

return [.init(
    ...
    start: event.dtStart,
    end: event.dtEnd,           // ← 가드 안 거친 raw 값
    startMinute: ...(event.dtStart),
    endMinute: ...(dtEnd),      // ← 가드 거친 값
    ...
)]
```

함수 진입 첫 줄에서 `dtEnd.isValid.not`인 경우를 `dtStart`로 폴백하는 로컬 변수를 만들어 둔다. 그런데 그 변수는 `endMinute` 계산할 때만 쓰이고, 정작 `snippet.end`에는 raw `event.dtEnd`가 들어간다.

서버가 어느 순간부터 일부 일정에 대해 `dtEnd`를 누락해서 내려보내기 시작했다. `event.dtEnd`는 `.invalidDate` (1970-01-01)이 됐다. `snippet.start = 2026-05-25`, `snippet.end = 1970-01-01`. 그리고 trap.

## 두 겹 가드

데이터 레이어에서 한 번, 표현 레이어에서 한 번.

**레이어 1 — root cause fix**

```swift
let resolvedDtEnd = event.dtEnd.isValid ? event.dtEnd : event.dtStart
let rawDistance = event.dtEnd.isValid
    ? event.dtEnd.timeIntervalSince1970 - event.dtStart.timeIntervalSince1970
    : TimeInterval(event.duration)
let dtDistance = max(0, rawDistance)  // 음수면 0 으로 클램프

// 비반복 일정
let safeEnd = max(event.dtStart, resolvedDtEnd)
return [.init(..., start: event.dtStart, end: safeEnd, ...)]

// 반복 일정
return [.init(..., start: start, end: start.addingTimeInterval(dtDistance), ...)]
```

`max(event.dtStart, resolvedDtEnd)`로 폴백하면 invalid도 막고, `end < start`인 비정상 데이터도 `end == start`로 정규화돼서 빠진다.

**레이어 2 — 표현 레이어 가드**

Date extension에 하나 추가했다.

```swift
extension Date {
    public func safeClosedRange(through other: Date) -> ClosedRange<Date>? {
        guard self <= other else { return nil }
        return self...other
    }
}
```

필터 closure 진입부에서 한 번 더 막는다.

```swift
guard snippet.start <= snippet.end else { return false }

let snippetRange = snippet.start.startOfDay()
    .safeClosedRange(through: snippet.end.addingTimeInterval(-1))

return dayRange ~= snippet.start
    || (snippetRange.map { $0 ~= date } ?? false)
```

데이터 레이어가 뚫려도 표현 레이어에서 안 죽는다.

## 교훈

**`a...b` 슈가는 입력이 신뢰될 때만 안전하다.** 사용자/서버 데이터가 들어오면 무조건 `guard a <= b` 또는 옵셔널 반환 헬퍼를 거쳐야 한다.

**invalid sentinel 가드는 한 곳만 막으면 의미 없다.** 함수 상단에서 정성스럽게 `isValid ? dtEnd : dtStart` 해놓고 정작 `snippet.end`에는 raw 값을 넣으면, 그 가드는 코드 리뷰 통과용 장식이 된다. 가드를 만들었으면 *그 함수 안 모든 사용처*에서 가드된 변수를 써야 한다.

**Crashlytics의 `SIGNAL_REPETITIVE` + 적은 영향 사용자 = 특정 데이터 트리거.** 같은 사용자가 9~10번씩 죽는 패턴은 보통 "특정 깨진 row가 사용자 DB에 누적된" 신호다. 코드 변경이 없는데 갑자기 크래시가 늘었다면 데이터 매핑 단계부터 의심해야 한다.

서버 탓하기 전에... 클라 매핑 한 번 더 보자. "갑자기 서버가 dtEnd 안 내려준다"가 첫 가설이었고, 이슈 트래커까지 뒤졌다. 결국 같은 코드가 운영에 있던 거였고, 서버 변화는 그냥 트리거였다. 우리 매핑이 그 트리거를 못 받아낸 게 진짜 버그였다.
