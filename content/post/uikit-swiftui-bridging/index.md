+++
author = "오깅중"
title = "UIKit ↔ SwiftUI 브릿징 — UIViewRepresentable vs UIHostingController 언제 뭘 쓸지"
slug = "uikit-swiftui-bridging"
date = "2026-05-13T11:00:00+09:00"
description = "UIKit과 SwiftUI를 같은 앱에서 섞어 쓸 때 등장하는 네 가지 다리(UIViewRepresentable, UIViewControllerRepresentable, UIHostingController, UIHostingConfiguration)의 용도, 패턴, 함정 정리."
categories = ["Swift"]
tags = ["SwiftUI", "UIKit", "UIViewRepresentable", "UIHostingController", "Migration"]
image = "thumbnail.png"
+++

iOS 앱에서 UIKit과 SwiftUI를 한 번에 다 들어내는 마이그레이션은 거의 없다. 새 화면은 SwiftUI로 짜지만 기존 UIKit 컴포넌트가 한참 남아 있고, 또 반대로 SwiftUI 화면 안에 PDFView 같은 UIKit 전용 컨트롤을 넣어야 하는 경우도 있다. 그래서 두 프레임워크 사이를 잇는 다리 네 가지는 거의 모든 프로젝트에서 한 번씩 만난다. 어떤 상황에 어떤 걸 골라야 하는지 한 번 정리해 둔다.

## 네 가지 다리 한눈에

| 다리 | 방향 | 단위 |
|------|------|------|
| `UIViewRepresentable` | UIKit → SwiftUI | View |
| `UIViewControllerRepresentable` | UIKit → SwiftUI | View Controller |
| `UIHostingController` | SwiftUI → UIKit | View Controller |
| `UIHostingConfiguration` | SwiftUI → UIKit | UICollectionView / UITableView Cell content |

방향과 단위가 다르다. 가운데 두 개가 가장 자주 쓰이고, 마지막 `UIHostingConfiguration`은 iOS 16+에서 cell 안 content를 SwiftUI로 채울 때 쓴다.

## UIViewRepresentable — UIKit View를 SwiftUI 안에 넣기

`UISearchBar`, `MKMapView`, `WKWebView` 같이 SwiftUI 대응이 부족하거나 옛 UIKit 자산이 많은 컴포넌트를 그대로 들이고 싶을 때 가장 흔한 다리다.

```swift
import SwiftUI
import WebKit

struct WebView: UIViewRepresentable {
    let url: URL

    func makeUIView(context: Context) -> WKWebView {
        WKWebView()
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        webView.load(URLRequest(url: url))
    }
}

struct ContentView: View {
    var body: some View {
        WebView(url: URL(string: "https://jun7680.github.io")!)
            .ignoresSafeArea()
    }
}
```

핵심은 두 메서드.

- `makeUIView(context:)` — **딱 한 번** UIView 인스턴스를 만든다. init 비용이 큰 객체는 여기서.
- `updateUIView(_:context:)` — SwiftUI 상태가 바뀔 때마다 호출. **여기에는 init 코드 절대 넣지 말기**. URL 갱신, 텍스트 동기화 같은 "변경" 작업만.

`updateUIView`는 body 재평가될 때마다 호출될 수 있어서 매번 새 객체를 만드는 식으로 짜면 성능과 상태가 깨진다.

## Coordinator — delegate, target-action을 SwiftUI로 흘리기

UIKit 컴포넌트 대부분은 delegate나 target-action으로 외부와 통신한다. 이걸 SwiftUI binding으로 잇는 자리가 Coordinator다.

```swift
struct SearchBar: UIViewRepresentable {
    @Binding var text: String

    func makeUIView(context: Context) -> UISearchBar {
        let bar = UISearchBar()
        bar.delegate = context.coordinator
        return bar
    }

    func updateUIView(_ uiView: UISearchBar, context: Context) {
        if uiView.text != text { uiView.text = text }
    }

    func makeCoordinator() -> Coordinator { Coordinator(text: $text) }

    final class Coordinator: NSObject, UISearchBarDelegate {
        @Binding var text: String
        init(text: Binding<String>) { self._text = text }

        func searchBar(_ searchBar: UISearchBar, textDidChange newText: String) {
            text = newText
        }
    }
}
```

`updateUIView`에서 `uiView.text != text` 가드를 거는 부분이 자주 빠지는데, 가드를 안 걸면 **delegate → binding 갱신 → updateUIView 호출 → text 다시 set → delegate 호출 → ...** 식의 무한 루프가 생길 수 있다. UIKit의 일부 컨트롤은 같은 값을 set 해도 delegate를 다시 부르기 때문.

## UIViewControllerRepresentable — VC 단위로 넣기

UIKit 컴포넌트가 자체 VC를 가지면(예: `PHPickerViewController`, `UIImagePickerController`, `MFMailComposeViewController`, `UIPageViewController`) 이쪽이 더 맞다.

```swift
struct ImagePicker: UIViewControllerRepresentable {
    @Binding var image: UIImage?
    @Environment(\.dismiss) private var dismiss

    func makeUIViewController(context: Context) -> UIImagePickerController {
        let picker = UIImagePickerController()
        picker.delegate = context.coordinator
        return picker
    }

    func updateUIViewController(_ vc: UIImagePickerController, context: Context) {}

    func makeCoordinator() -> Coordinator { Coordinator(parent: self) }

    final class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
        let parent: ImagePicker
        init(parent: ImagePicker) { self.parent = parent }

        func imagePickerController(
            _ picker: UIImagePickerController,
            didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]
        ) {
            parent.image = info[.originalImage] as? UIImage
            parent.dismiss()
        }
    }
}
```

`@Environment(\.dismiss)`를 코디네이터가 아닌 부모 구조체 쪽에서 잡아두고, 코디네이터가 `parent.dismiss()`로 호출하는 패턴이 깔끔. SwiftUI 환경 변수를 코디네이터에서 직접 잡으려고 하면 잘 안 풀린다.

## UIHostingController — SwiftUI View를 UIKit 안에 넣기

방향이 반대인 경우. UIKit 화면(특히 옛 storyboard 기반 화면)에서 새로 짠 SwiftUI View 하나만 끼우고 싶을 때.

```swift
import SwiftUI
import UIKit

final class LegacyVC: UIViewController {
    override func viewDidLoad() {
        super.viewDidLoad()

        let host = UIHostingController(rootView: ProfileCard(name: "오깅중"))
        addChild(host)
        view.addSubview(host.view)
        host.view.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([
            host.view.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            host.view.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            host.view.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            host.view.heightAnchor.constraint(equalToConstant: 120)
        ])
        host.didMove(toParent: self)
    }
}
```

VC를 자식으로 추가하는 표준 컨테이너 패턴 그대로. SwiftUI 쪽 상태가 바뀌면 SwiftUI가 알아서 자기 영역만 다시 그린다.

### 사이즈 자동 계산 — sizingOptions

iOS 16부터 `sizingOptions`로 hosting controller 크기를 SwiftUI 자체 intrinsic size에 맞춰 자동 조정 가능.

```swift
let host = UIHostingController(rootView: ProfileCard(...))
host.sizingOptions = [.intrinsicContentSize, .preferredContentSize]
```

이전엔 SwiftUI가 그리는 콘텐츠 크기를 UIKit이 못 잡아서 명시적 constraint를 다 잡아주거나 `view.invalidateIntrinsicContentSize()`를 수동으로 부르던 자리. 16+ 타깃이면 사용하면 편하다.

## UIHostingConfiguration — Cell 콘텐츠를 SwiftUI로

iOS 16에서 추가된 가장 깔끔한 다리. `UICollectionView` / `UITableView` cell의 content를 SwiftUI로 채운다.

```swift
let cellRegistration = UICollectionView.CellRegistration<UICollectionViewListCell, Todo> { cell, _, todo in
    cell.contentConfiguration = UIHostingConfiguration {
        HStack {
            Image(systemName: todo.done ? "checkmark.circle.fill" : "circle")
            Text(todo.title)
            Spacer()
        }
        .padding(.vertical, 4)
    }
}
```

기존 UICollectionView 인프라(`UICollectionViewDiffableDataSource`, `UICollectionViewCompositionalLayout`)는 그대로 두고 cell 안만 SwiftUI로 채우는 식. 새 list 화면을 통째로 SwiftUI로 옮길지 망설여질 때 가장 부담 적은 선택.

## 자주 마주치는 함정

### updateUIView/UIViewController 안에서 무거운 작업

`updateUIView`는 SwiftUI body가 재평가될 때마다 호출될 수 있다. 그 안에서 네트워크 호출, 무거운 레이아웃 계산 같은 걸 하면 체감 성능이 폭락한다. "정말 바뀐 값에 대해서만" 변경하는 가드를 거는 게 기본.

### Coordinator의 강한 참조

Coordinator가 parent struct를 강하게 들고 있는데, parent는 또 Coordinator를 들고 있다. 보통은 SwiftUI가 라이프사이클을 잘 정리해주지만, 콜백 클로저를 외부로 흘려보내거나 NotificationCenter에 register 하면 cycle이 생길 수 있다. parent를 `weak`나 closure capture로 깔끔하게 잘라두는 게 안전.

### UIHostingController가 빈 공간을 만드는 경우

UIHostingController는 기본적으로 자기 부모 VC의 safe area를 따른다. 그래서 부모 VC가 navigation bar를 가지면 SwiftUI 화면 위쪽이 비어 보이는 현상이 생긴다. `host.safeAreaRegions = []`로 무시하거나, SwiftUI 쪽에서 `.ignoresSafeArea()`로 처리.

### body가 너무 자주 재호출

UIKit에서 SwiftUI cell로 옮길 때, 외부 ObservableObject 한 곳에 모든 데이터를 묶어두면 list 한 칸의 변화에도 모든 cell이 다시 그려진다. SwiftData/`@Observable`로 옮기면 KeyPath 기반 추적이라 같은 코드여도 cell 단위 갱신이 자연스러워짐 — 이전 글에서 정리한 [`@Observable` 도입기](/p/state-stateobject-observedobject-observable-ios17/)와 같은 흐름.

## 언제 뭘 고르나

흐름표로 정리.

| 상황 | 다리 |
|------|------|
| SwiftUI 화면 안에 UIKit View 한 조각 | `UIViewRepresentable` |
| SwiftUI 화면 안에 UIKit VC(피커 등) | `UIViewControllerRepresentable` |
| UIKit 화면 한 부분만 SwiftUI로 | `UIHostingController` (자식 VC 패턴) |
| UICollectionView / UITableView cell 콘텐츠 | `UIHostingConfiguration` (iOS 16+) |
| 화면 통째로 SwiftUI로 갈 수 있다 | 다리 안 만들고 그냥 SwiftUI View |

마이그레이션 중인 프로젝트면 마지막 줄이 목표지만, 도착하기 전까지는 위 네 줄을 자주 만난다.

## 정리

- 네 다리의 방향과 단위가 다르다. **방향(어디서 어디로)** + **단위(View냐 VC냐 Cell이냐)** 두 축으로 고르면 헷갈리지 않음.
- Representable의 `update`는 "변경"용으로만. 초기화는 `make`에 가둔다.
- Coordinator로 delegate를 SwiftUI binding으로 흘리되 무한 루프 가드를 잊지 말기.
- 16+ 타깃이면 cell 콘텐츠는 `UIHostingConfiguration`이 가장 부담 적은 마이그 경로.

옛 UIKit 자산을 한 번에 다 들어낼 필요 없이, 화면 단위 / 컴포넌트 단위로 위 네 다리를 활용해 천천히 SwiftUI 비중을 늘려가는 게 가장 안정적인 마이그레이션 흐름인 것 같다.
