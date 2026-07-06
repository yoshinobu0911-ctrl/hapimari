export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      calls: {
        Row: {
          created_at: string | null
          duration_seconds: number | null
          ended_at: string | null
          id: string
          match_id: string
          started_at: string | null
        }
        Insert: {
          created_at?: string | null
          duration_seconds?: number | null
          ended_at?: string | null
          id?: string
          match_id: string
          started_at?: string | null
        }
        Update: {
          created_at?: string | null
          duration_seconds?: number | null
          ended_at?: string | null
          id?: string
          match_id?: string
          started_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "calls_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_stats: {
        Row: {
          active_female: number | null
          active_male: number | null
          date: string
          dates_confirmed: number | null
          forced_withdrawals: number | null
          new_matches: number | null
        }
        Insert: {
          active_female?: number | null
          active_male?: number | null
          date: string
          dates_confirmed?: number | null
          forced_withdrawals?: number | null
          new_matches?: number | null
        }
        Update: {
          active_female?: number | null
          active_male?: number | null
          date?: string
          dates_confirmed?: number | null
          forced_withdrawals?: number | null
          new_matches?: number | null
        }
        Relationships: []
      }
      date_proposals: {
        Row: {
          area_suggestion: string | null
          confirmed_slot: Json | null
          created_at: string | null
          feedback_a: string | null
          feedback_b: string | null
          id: string
          intent_a: boolean | null
          intent_b: boolean | null
          match_id: string
          proposed_slots: Json | null
          status: string
        }
        Insert: {
          area_suggestion?: string | null
          confirmed_slot?: Json | null
          created_at?: string | null
          feedback_a?: string | null
          feedback_b?: string | null
          id?: string
          intent_a?: boolean | null
          intent_b?: boolean | null
          match_id: string
          proposed_slots?: Json | null
          status?: string
        }
        Update: {
          area_suggestion?: string | null
          confirmed_slot?: Json | null
          created_at?: string | null
          feedback_a?: string | null
          feedback_b?: string | null
          id?: string
          intent_a?: boolean | null
          intent_b?: boolean | null
          match_id?: string
          proposed_slots?: Json | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "date_proposals_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
        ]
      }
      likes: {
        Row: {
          created_at: string | null
          from_user: string
          id: string
          message: string | null
          to_user: string
        }
        Insert: {
          created_at?: string | null
          from_user: string
          id?: string
          message?: string | null
          to_user: string
        }
        Update: {
          created_at?: string | null
          from_user?: string
          id?: string
          message?: string | null
          to_user?: string
        }
        Relationships: [
          {
            foreignKeyName: "likes_from_user_fkey"
            columns: ["from_user"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "likes_to_user_fkey"
            columns: ["to_user"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      matches: {
        Row: {
          call_unlocked: boolean | null
          created_at: string | null
          id: string
          message_count: number
          user_a: string
          user_b: string
        }
        Insert: {
          call_unlocked?: boolean | null
          created_at?: string | null
          id?: string
          message_count?: number
          user_a: string
          user_b: string
        }
        Update: {
          call_unlocked?: boolean | null
          created_at?: string | null
          id?: string
          message_count?: number
          user_a?: string
          user_b?: string
        }
        Relationships: [
          {
            foreignKeyName: "matches_user_a_fkey"
            columns: ["user_a"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matches_user_b_fkey"
            columns: ["user_b"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          body: string
          created_at: string | null
          flagged: boolean
          id: string
          match_id: string
          sender: string
        }
        Insert: {
          body: string
          created_at?: string | null
          flagged?: boolean
          id?: string
          match_id: string
          sender: string
        }
        Update: {
          body?: string
          created_at?: string | null
          flagged?: boolean
          id?: string
          match_id?: string
          sender?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_sender_fkey"
            columns: ["sender"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          available_times: string[] | null
          bio: string | null
          birth_date: string
          children_living_together: boolean | null
          city: string | null
          cohabit_view: string | null
          created_at: string | null
          gender: string
          has_children: boolean
          id: string
          income_verified: boolean
          is_verified: boolean
          marital_history: string
          marriage_intent: string | null
          money_view: string | null
          nickname: string
          ok_child_date: boolean | null
          photo_urls: string[] | null
          prefecture: string
          single_cert_verified: boolean
          status: string
          understands_children: boolean
          understands_remarriage: boolean
          value_tags: string[]
          voice_profile_url: string | null
        }
        Insert: {
          available_times?: string[] | null
          bio?: string | null
          birth_date: string
          children_living_together?: boolean | null
          city?: string | null
          cohabit_view?: string | null
          created_at?: string | null
          gender: string
          has_children?: boolean
          id: string
          income_verified?: boolean
          is_verified?: boolean
          marital_history: string
          marriage_intent?: string | null
          money_view?: string | null
          nickname: string
          ok_child_date?: boolean | null
          photo_urls?: string[] | null
          prefecture: string
          single_cert_verified?: boolean
          status?: string
          understands_children?: boolean
          understands_remarriage?: boolean
          value_tags?: string[]
          voice_profile_url?: string | null
        }
        Update: {
          available_times?: string[] | null
          bio?: string | null
          birth_date?: string
          children_living_together?: boolean | null
          city?: string | null
          cohabit_view?: string | null
          created_at?: string | null
          gender?: string
          has_children?: boolean
          id?: string
          income_verified?: boolean
          is_verified?: boolean
          marital_history?: string
          marriage_intent?: string | null
          money_view?: string | null
          nickname?: string
          ok_child_date?: boolean | null
          photo_urls?: string[] | null
          prefecture?: string
          single_cert_verified?: boolean
          status?: string
          understands_children?: boolean
          understands_remarriage?: boolean
          value_tags?: string[]
          voice_profile_url?: string | null
        }
        Relationships: []
      }
      reports: {
        Row: {
          created_at: string | null
          detail: string | null
          id: string
          reason: string
          reported: string
          reporter: string
          status: string
        }
        Insert: {
          created_at?: string | null
          detail?: string | null
          id?: string
          reason: string
          reported: string
          reporter: string
          status?: string
        }
        Update: {
          created_at?: string | null
          detail?: string | null
          id?: string
          reason?: string
          reported?: string
          reporter?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "reports_reported_fkey"
            columns: ["reported"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reports_reporter_fkey"
            columns: ["reporter"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      verifications: {
        Row: {
          created_at: string | null
          document_url: string
          id: string
          kind: string
          reject_reason: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          document_url: string
          id?: string
          kind: string
          reject_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          document_url?: string
          id?: string
          kind?: string
          reject_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "verifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      is_match_participant: { Args: { target_match: string }; Returns: boolean }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const

