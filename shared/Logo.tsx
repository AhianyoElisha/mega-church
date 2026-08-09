import Link from 'next/link'
import React from 'react'
import LogoSvg from './LogoSvg'

interface LogoProps {
  className?: string
  href?: string
}

const Logo: React.FC<LogoProps> = ({ className = 'w-28 sm:w-32', href = '/' }) => {
  return (
    <Link
      href={href}
      className={`inline-block text-neutral-950 focus:ring-0 focus:outline-hidden dark:text-white ${className}`}
    >
      <LogoSvg />
    </Link>
  )
}

export default Logo
