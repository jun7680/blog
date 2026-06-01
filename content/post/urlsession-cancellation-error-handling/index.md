+++
author = "오깅중"
title = "URLSession 취소를 실패 알림으로 보여주지 않기"
slug = "urlsession-cancellation-error-handling"
date = "2026-06-02T08:00:00+09:00"
description = "Swift concurrency에서 URLSession 요청을 취소했는데 에러 토스트가 뜨는 문제를 CancellationError와 URLError.cancelled 기준으로 정리한다."
categories = ["Swift"]
tags = ["Swift", "URLSession", "Concurrency", "Cancellation", "AsyncAwait"]
image = "thumbnail.png"
+++

검색 화면이나 탭 전환 화면에서 네트워크 요청을 취소하는 건 흔하다. 사용자가 검색어를 바꾸면 이전 요청은 더 이상 필요 없고, 화면을 나가면 진행 중인 API도 굳이 끝까지 기다릴 이유가 없다.

그런데 취소를 붙이고 나면 이상한 일이 생긴다. 사용자가 화면을 나갔을 뿐인데 "네트워크 오류가 발생했습니다" 토스트가 뜨거나, 검색어를 빠르게 지울 때마다 실패 로그가 쌓인다. 실제 실패가 아니라 **의도한 취소를 에러 UI로 처리한 것**이다.

Swift concurrency에서 `URLSession`을 쓸 때는 실패와 취소를 분리해서 봐야 한다.

## 처음에는 모든 catch가 실패처럼 보인다

흔한 코드는 이렇게 시작한다.

```swift
func loadProducts(query: String) async {
    isLoading = true

    do {
        products = try await api.searchProducts(query: query)
    } catch {
        errorMessage = "상품을 불러오지 못했습니다."
    }

    isLoading = false
}
```

요청이 정말 실패했을 때는 괜찮다. 문제는 task가 취소된 경우도 `catch`로 들어온다는 점이다. 사용자가 화면을 벗어났거나 `.task(id:)`가 새 검색어 때문에 이전 작업을 취소했는데, 그걸 일반 실패처럼 처리하면 UI가 시끄러워진다.

Apple 문서의 [`CancellationError`](https://developer.apple.com/documentation/swift/cancellationerror)는 task가 취소되었음을 나타내는 에러다. 네트워크 계층에서는 [`URLError.Code.cancelled`](https://developer.apple.com/documentation/foundation/urlerror/code/cancelled)로 내려오는 경우도 있다. 둘 다 사용자에게 "실패"라고 말할 대상은 아니다.

## 취소는 조용히 빠져나간다

나는 보통 화면 state를 바꾸기 전에 취소를 먼저 걸러낸다.

```swift
func loadProducts(query: String) async {
    isLoading = true
    errorMessage = nil

    do {
        let response = try await api.searchProducts(query: query)
        guard !Task.isCancelled else { return }
        products = response
    } catch is CancellationError {
        return
    } catch let error as URLError where error.code == .cancelled {
        return
    } catch {
        guard !Task.isCancelled else { return }
        errorMessage = "상품을 불러오지 못했습니다."
    }

    isLoading = false
}
```

이 코드에는 한 가지 문제가 있다. `return`으로 빠져나갈 때 `isLoading`이 그대로 남을 수 있다. 그래서 실제 코드에서는 `defer`를 같이 둔다.

```swift
func loadProducts(query: String) async {
    isLoading = true
    errorMessage = nil

    defer {
        if !Task.isCancelled {
            isLoading = false
        }
    }

    do {
        let response = try await api.searchProducts(query: query)
        try Task.checkCancellation()
        products = response
    } catch is CancellationError {
        return
    } catch let error as URLError where error.code == .cancelled {
        return
    } catch {
        errorMessage = "상품을 불러오지 못했습니다."
    }
}
```

`Task.checkCancellation()`은 이미 취소된 task라면 `CancellationError`를 던진다. 응답은 왔지만 그 사이 사용자가 다른 검색어로 넘어간 경우에 오래된 결과를 반영하지 않게 막을 수 있다.

## API 계층에서 취소를 감출지 정한다

취소 처리를 View마다 반복하면 금방 지저분해진다. 그래서 API 계층에 helper를 둘 수 있다.

```swift
extension Error {
    var isCancellation: Bool {
        if self is CancellationError {
            return true
        }

        if let urlError = self as? URLError, urlError.code == .cancelled {
            return true
        }

        return false
    }
}
```

그러면 화면 코드는 조금 덜 시끄럽다.

```swift
do {
    products = try await api.searchProducts(query: query)
} catch where error.isCancellation {
    return
} catch {
    errorMessage = "상품을 불러오지 못했습니다."
}
```

다만 취소를 API 계층에서 아예 `nil`로 바꿔버리는 방식은 조심한다.

```swift
func searchProducts(query: String) async -> [Product]? {
    do {
        return try await request(...)
    } catch where error.isCancellation {
        return nil
    } catch {
        return nil
    }
}
```

이렇게 하면 취소와 실제 실패가 둘 다 `nil`이 된다. 호출하는 쪽은 빈 결과인지, 취소인지, 서버 오류인지 구분할 수 없다. 취소를 조용히 처리하더라도 실제 실패 정보까지 같이 지우면 디버깅이 어려워진다.

## `.task(id:)`에서는 취소가 정상 흐름이다

SwiftUI 검색 화면에서 자주 쓰는 패턴이 있다.

```swift
.task(id: searchText) {
    await viewModel.search(searchText)
}
```

`searchText`가 바뀌면 이전 task는 취소되고 새 task가 시작된다. 이 구조에서는 취소가 예외적인 일이 아니라 정상 흐름이다. 사용자가 "swift"를 입력하면 `s`, `sw`, `swi`, `swif` 요청은 대부분 취소될 수 있다.

그래서 검색 화면에서 취소 로그를 error 레벨로 남기면 로그가 거의 소음이 된다.

```swift
catch where error.isCancellation {
    logger.debug("Search request cancelled")
}
```

정말 필요하다면 debug 정도로 남기고, 사용자에게 보여주는 에러 상태는 건드리지 않는 게 낫다.

## 오래된 응답도 취소처럼 다룬다

취소가 항상 네트워크 요청을 즉시 멈춰주는 건 아니다. 응답이 이미 도착했거나, 중간 레이어가 취소를 제대로 전달하지 못하면 오래된 결과가 늦게 들어올 수 있다.

그래서 검색에서는 요청 토큰을 같이 둔다.

```swift
@MainActor
final class ProductSearchModel: ObservableObject {
    @Published private(set) var products: [Product] = []
    @Published private(set) var errorMessage: String?

    private var currentQuery = ""

    func search(_ query: String) async {
        currentQuery = query

        do {
            let response = try await api.searchProducts(query: query)
            try Task.checkCancellation()
            guard currentQuery == query else { return }
            products = response
        } catch where error.isCancellation {
            return
        } catch {
            guard currentQuery == query else { return }
            errorMessage = "검색에 실패했습니다."
        }
    }
}
```

`Task.checkCancellation()`과 `currentQuery` 비교는 역할이 조금 다르다. 하나는 task 취소 여부를 보고, 하나는 이 응답이 아직 화면이 원하는 검색어의 응답인지 본다. API 래퍼가 복잡하거나 debounce, cache가 섞이면 둘 다 있는 편이 안전했다.

## 로딩 상태는 취소 때 어떻게 할지 정한다

취소 시 `isLoading`을 false로 바꿀지 말지도 상황에 따라 다르다.

검색어 변경으로 이전 요청이 취소되고 곧바로 새 요청이 시작되는 경우, 이전 task의 `defer`가 `isLoading = false`를 찍으면 새 요청 로딩 표시가 깜빡일 수 있다. 이때는 query 기준으로 현재 요청인지 확인하고 로딩을 끈다.

```swift
let requestQuery = query
isLoading = true

defer {
    if currentQuery == requestQuery {
        isLoading = false
    }
}
```

화면이 사라져서 task가 취소된 경우에는 어차피 View가 없어지므로 굳이 에러나 로딩 state를 정리하려고 애쓰지 않아도 된다. 남아 있는 화면에서 같은 view model을 재사용한다면 그때만 명시적으로 초기화하면 된다.

## 내가 잡은 기준

네트워크 취소 처리는 지금 이렇게 둔다.

1. `CancellationError`와 `URLError.cancelled`는 사용자 에러로 보여주지 않는다.
2. 취소는 검색, 화면 이탈, 탭 변경에서 정상 흐름으로 본다.
3. 응답 반영 전 `Task.checkCancellation()` 또는 `Task.isCancelled`를 확인한다.
4. 검색처럼 최신 요청만 의미 있는 화면은 query/token도 같이 비교한다.
5. API helper는 취소 판별을 도와주되, 실제 실패까지 숨기지는 않는다.
6. 취소 로그는 필요해도 debug 레벨로 둔다.

취소를 붙였는데 에러 처리가 더 지저분해졌다면, 네트워크가 불안정한 게 아니라 상태 구분이 부족한 경우가 많다. 사용자에게 보여줄 실패와 앱이 의도적으로 멈춘 작업을 분리하면 화면이 훨씬 조용해진다.
