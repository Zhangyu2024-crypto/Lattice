import { useState } from 'react'
import { Star } from 'lucide-react'

interface Props {
  value: number | undefined
  onChange?: (rating: number | undefined) => void
  readonly?: boolean
}

export default function StarRating({ value, onChange, readonly }: Props) {
  const [hover, setHover] = useState(0)

  const handleClick = (star: number) => {
    if (readonly || !onChange) return
    onChange(star === value ? undefined : (star as 1 | 2 | 3 | 4 | 5))
  }

  return (
    <span
      style={{ display: 'inline-flex', gap: 1, alignItems: 'center' }}
      onMouseLeave={() => setHover(0)}
    >
      {[1, 2, 3, 4, 5].map((star) => {
        const filled = hover ? star <= hover : star <= (value ?? 0)
        return (
          <Star
            key={star}
            size={14}
            strokeWidth={1.6}
            fill={filled ? '#f59e0b' : 'none'}
            color={filled ? '#f59e0b' : '#555'}
            style={{ cursor: readonly ? 'default' : 'pointer' }}
            onMouseEnter={() => !readonly && setHover(star)}
            onClick={() => handleClick(star)}
          />
        )
      })}
    </span>
  )
}
