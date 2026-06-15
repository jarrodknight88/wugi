import ExpoModulesCore
import UIKit

// Process-wide tiny in-memory cache. No third-party image library.
private let secureImageCache = NSCache<NSURL, UIImage>()

public final class SecureImageView: ExpoView, UIScrollViewDelegate, UITextFieldDelegate {
  // JS event: secure:true → hosted inside the capture-excluded canvas;
  // secure:false → private hierarchy not found, rendering normally (unprotected).
  private let onSecureStateChange = EventDispatcher()

  // ── Secure plumbing ──────────────────────────────────────────────────
  private let secureField = UITextField()
  private weak var secureCanvas: UIView?    // the capture-excluded layer host, if found
  private var isSecure = false
  private var didReportState = false

  // ── Content ──────────────────────────────────────────────────────────
  private let scrollView = UIScrollView()
  private let imageView = UIImageView()
  private var currentURL: URL?
  private var loadTask: URLSessionDataTask?
  private var maxZoom: Double = 4.0

  // Whichever view we ended up hosting the scrollView in (canvas or self).
  private weak var contentHost: UIView?

  public required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    clipsToBounds = true
    setupScrollView()
    setupSecureContainer()
  }

  deinit {
    loadTask?.cancel()
  }

  // MARK: - Setup

  private func setupScrollView() {
    scrollView.minimumZoomScale = 1.0
    scrollView.maximumZoomScale = CGFloat(maxZoom)
    scrollView.bouncesZoom = true
    scrollView.showsHorizontalScrollIndicator = false
    scrollView.showsVerticalScrollIndicator = false
    scrollView.delegate = self
    // Let single taps fall through to the RN responder system quickly; we add
    // NO tap recognizers natively (single/double tap stay owned by RN).
    scrollView.delaysContentTouches = false
    scrollView.canCancelContentTouches = true
    scrollView.contentInsetAdjustmentBehavior = .never

    imageView.contentMode = .scaleAspectFit
    imageView.isUserInteractionEnabled = true
    scrollView.addSubview(imageView)
  }

  private func setupSecureContainer() {
    // The field must live in the hierarchy for its secure canvas layer to exist,
    // but it must never become first responder (no keyboard) — see delegate.
    secureField.isSecureTextEntry = true
    secureField.delegate = self
    secureField.frame = bounds
    secureField.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    addSubview(secureField)
    layoutIfNeeded()

    // Defensively locate the private secure canvas subview. iOS 13–15 names it
    // `_UITextLayoutCanvasView`; match by class-name substring so we don't bind a
    // private symbol and tolerate renames. Fall back to normal rendering if absent.
    let canvas = secureField.subviews.first { subview in
      String(describing: type(of: subview)).contains("CanvasView")
    }

    if let canvas = canvas {
      // Host our content INSIDE the secure canvas (do not reparent the canvas out
      // of the field — that would drop the capture exclusion). Strip its default
      // content and add the scrollView.
      canvas.subviews.forEach { $0.removeFromSuperview() }
      canvas.isUserInteractionEnabled = true
      scrollView.frame = canvas.bounds
      scrollView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
      canvas.addSubview(scrollView)
      secureCanvas = canvas
      contentHost = canvas
      isSecure = true
    } else {
      // Fallback: render normally (NOT capture-protected). Report to JS.
      secureField.removeFromSuperview()
      scrollView.frame = bounds
      scrollView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
      addSubview(scrollView)
      contentHost = self
      isSecure = false
    }
  }

  // MARK: - Layout

  public override func layoutSubviews() {
    super.layoutSubviews()
    // Keep the field (and thus its canvas) filling our bounds.
    secureField.frame = bounds
    if let host = contentHost {
      scrollView.frame = host.bounds
    }
    // Reset zoom geometry to the current bounds when not actively zoomed.
    if scrollView.zoomScale == scrollView.minimumZoomScale {
      imageView.frame = scrollView.bounds
      scrollView.contentSize = scrollView.bounds.size
    }
    reportStateIfNeeded()
  }

  private func reportStateIfNeeded() {
    guard !didReportState, bounds.width > 0 else { return }
    didReportState = true
    onSecureStateChange(["secure": isSecure])
  }

  // MARK: - Props

  func setMaxZoomScale(_ scale: Double) {
    maxZoom = max(1.0, scale)
    scrollView.maximumZoomScale = CGFloat(maxZoom)
  }

  func setUri(_ uri: String) {
    guard let url = URL(string: uri) else { return }
    if url == currentURL { return }
    currentURL = url
    loadTask?.cancel()

    // Reset zoom for the new image.
    scrollView.setZoomScale(scrollView.minimumZoomScale, animated: false)

    if let cached = secureImageCache.object(forKey: url as NSURL) {
      imageView.image = cached
      setNeedsLayout()
      return
    }

    let task = URLSession.shared.dataTask(with: url) { [weak self] data, _, error in
      guard let self = self else { return }
      guard error == nil, let data = data, let image = UIImage(data: data) else {
        // Load error — leave the view blank (RN overlay/Buy bar still render).
        return
      }
      secureImageCache.setObject(image, forKey: url as NSURL)
      DispatchQueue.main.async {
        // Ignore if the uri changed while loading.
        guard self.currentURL == url else { return }
        self.imageView.image = image
        self.setNeedsLayout()
      }
    }
    loadTask = task
    task.resume()
  }

  // MARK: - UIScrollViewDelegate (pinch + pan only)

  public func viewForZooming(in scrollView: UIScrollView) -> UIView? {
    return imageView
  }

  public func scrollViewDidZoom(_ scrollView: UIScrollView) {
    // Keep the image centered while zoomed/zooming out.
    let bounds = scrollView.bounds.size
    let content = scrollView.contentSize
    let offsetX = max((bounds.width - content.width) * 0.5, 0)
    let offsetY = max((bounds.height - content.height) * 0.5, 0)
    imageView.center = CGPoint(
      x: content.width * 0.5 + offsetX,
      y: content.height * 0.5 + offsetY
    )
  }

  // MARK: - UITextFieldDelegate

  // Never allow the secure field to begin editing → no keyboard, ever. The field
  // exists solely to vend its capture-excluded canvas layer.
  public func textFieldShouldBeginEditing(_ textField: UITextField) -> Bool {
    return false
  }
}
