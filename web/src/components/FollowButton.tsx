export function FollowButton({
  following,
  friends,
  onClick,
  disabled,
  className = '',
}: {
  following: boolean
  friends?: boolean
  onClick: () => void
  disabled?: boolean
  className?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={following}
      className={`shrink-0 rounded-xl px-4 py-2 text-sm font-semibold transition active:scale-95 disabled:opacity-60 ${
        following ? 'border border-forest/25 text-forest' : 'bg-forest text-paper'
      } ${className}`}
    >
      {friends ? 'Friends ✓' : following ? 'Following' : 'Follow'}
    </button>
  )
}
