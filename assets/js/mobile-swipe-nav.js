$(document).ready(function() {
  const wrapper = $('#wrapper');
  const overlay = $('#sidebar-overlay');
  const SWIPE_THRESHOLD = 50; // Minimum distance for a swipe

  let touchStartX = 0;
  let touchStartY = 0;
  let touchEndX = 0;
  let touchEndY = 0;

  function handleSwipe() {
    // Check if it was a significant horizontal swipe, not just a tap or vertical scroll
    if (Math.abs(touchEndX - touchStartX) < SWIPE_THRESHOLD) {
        return;
    }

    // Swipe Right (to open sidebar)
    if (touchEndX > touchStartX) {
      wrapper.addClass('sidebar-toggled');
    }

    // Swipe Left (to close sidebar)
    if (touchEndX < touchStartX) {
      wrapper.removeClass('sidebar-toggled');
    }
  }
  
  // --- MODIFIED FUNCTION ---
  function attachSwipeListeners() {
    // Use native addEventListener to specify passive: false
    document.addEventListener('touchstart', handleTouchStart, { passive: true });
    document.addEventListener('touchmove', handleTouchMove, { passive: false }); // Explicitly NOT passive
    document.addEventListener('touchend', handleTouchEnd, { passive: true });
  }
  
  // --- MODIFIED FUNCTION ---
  function detachSwipeListeners() {
    document.removeEventListener('touchstart', handleTouchStart);
    document.removeEventListener('touchmove', handleTouchMove);
    document.removeEventListener('touchend', handleTouchEnd);
  }

  // --- HELPER FUNCTIONS FOR NATIVE LISTENERS ---
  function handleTouchStart(event) {
    touchStartX = event.touches[0].screenX;
    touchStartY = event.touches[0].screenY;
  }

  function handleTouchMove(event) {
    let currentX = event.touches[0].screenX;
    let currentY = event.touches[0].screenY;
    
    // If horizontal movement is greater than vertical, it's a swipe.
    // Prevent the browser's default action (like back navigation).
    if (Math.abs(currentX - touchStartX) > Math.abs(currentY - touchStartY)) {
        event.preventDefault();
    }
  }

  function handleTouchEnd(event) {
    touchEndX = event.changedTouches[0].screenX;
    touchEndY = event.changedTouches[0].screenY;
    handleSwipe();
  }
  // --- END OF NEW HELPER FUNCTIONS ---


  function checkScreenWidth() {
    if (window.innerWidth < 768) {
        attachSwipeListeners();
    } else {
        detachSwipeListeners();
        wrapper.removeClass('sidebar-toggled'); // Ensure it's closed on desktop
    }
  }

  // Close sidebar when clicking the overlay
  overlay.on('click', function() {
    wrapper.removeClass('sidebar-toggled');
  });

  // Initial check on page load
  checkScreenWidth();

  // Check again on window resize
  $(window).on('resize', checkScreenWidth);
});