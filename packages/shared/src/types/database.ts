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
      available_time_master: {
        Row: {
          label: string
          sort_order: number
          value: string
        }
        Insert: {
          label: string
          sort_order: number
          value: string
        }
        Update: {
          label?: string
          sort_order?: number
          value?: string
        }
        Relationships: []
      }
      block_carryover: {
        Row: {
          blocked_hash: string
          blocker_hash: string
          created_at: string
        }
        Insert: {
          blocked_hash: string
          blocker_hash: string
          created_at?: string
        }
        Update: {
          blocked_hash?: string
          blocker_hash?: string
          created_at?: string
        }
        Relationships: []
      }
      blocks: {
        Row: {
          blocked: string
          blocker: string
          created_at: string | null
          id: string
        }
        Insert: {
          blocked: string
          blocker: string
          created_at?: string | null
          id?: string
        }
        Update: {
          blocked?: string
          blocker?: string
          created_at?: string | null
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "blocks_blocked_fkey"
            columns: ["blocked"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "blocks_blocked_fkey"
            columns: ["blocked"]
            isOneToOne: false
            referencedRelation: "profiles_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "blocks_blocker_fkey"
            columns: ["blocker"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "blocks_blocker_fkey"
            columns: ["blocker"]
            isOneToOne: false
            referencedRelation: "profiles_public"
            referencedColumns: ["id"]
          },
        ]
      }
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
          cancelled_at: string | null
          confirmed_at: string | null
          confirmed_slot: Json | null
          created_at: string | null
          date_on: string | null
          done_at: string | null
          feedback_a: string | null
          feedback_b: string | null
          first_proposed_at: string | null
          id: string
          intent_a: boolean | null
          intent_b: boolean | null
          intent_matched_at: string | null
          match_id: string
          proposed_slots: Json | null
          status: string
        }
        Insert: {
          area_suggestion?: string | null
          cancelled_at?: string | null
          confirmed_at?: string | null
          confirmed_slot?: Json | null
          created_at?: string | null
          date_on?: string | null
          done_at?: string | null
          feedback_a?: string | null
          feedback_b?: string | null
          first_proposed_at?: string | null
          id?: string
          intent_a?: boolean | null
          intent_b?: boolean | null
          intent_matched_at?: string | null
          match_id: string
          proposed_slots?: Json | null
          status?: string
        }
        Update: {
          area_suggestion?: string | null
          cancelled_at?: string | null
          confirmed_at?: string | null
          confirmed_slot?: Json | null
          created_at?: string | null
          date_on?: string | null
          done_at?: string | null
          feedback_a?: string | null
          feedback_b?: string | null
          first_proposed_at?: string | null
          id?: string
          intent_a?: boolean | null
          intent_b?: boolean | null
          intent_matched_at?: string | null
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
      file_deletion_queue: {
        Row: {
          bucket_id: string
          deleted_at: string | null
          enqueued_at: string
          path: string
        }
        Insert: {
          bucket_id: string
          deleted_at?: string | null
          enqueued_at?: string
          path: string
        }
        Update: {
          bucket_id?: string
          deleted_at?: string | null
          enqueued_at?: string
          path?: string
        }
        Relationships: []
      }
      fraud_words: {
        Row: {
          word: string
        }
        Insert: {
          word: string
        }
        Update: {
          word?: string
        }
        Relationships: []
      }
      identity_ledger: {
        Row: {
          ban_reason: string | null
          banned: boolean
          email_hash: string
          last_withdrawn_at: string | null
          report_count: number
          suppressed: boolean
          updated_at: string
          withdrawal_count: number
        }
        Insert: {
          ban_reason?: string | null
          banned?: boolean
          email_hash: string
          last_withdrawn_at?: string | null
          report_count?: number
          suppressed?: boolean
          updated_at?: string
          withdrawal_count?: number
        }
        Update: {
          ban_reason?: string | null
          banned?: boolean
          email_hash?: string
          last_withdrawn_at?: string | null
          report_count?: number
          suppressed?: boolean
          updated_at?: string
          withdrawal_count?: number
        }
        Relationships: []
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
            foreignKeyName: "likes_from_user_fkey"
            columns: ["from_user"]
            isOneToOne: false
            referencedRelation: "profiles_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "likes_to_user_fkey"
            columns: ["to_user"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "likes_to_user_fkey"
            columns: ["to_user"]
            isOneToOne: false
            referencedRelation: "profiles_public"
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
            foreignKeyName: "matches_user_a_fkey"
            columns: ["user_a"]
            isOneToOne: false
            referencedRelation: "profiles_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matches_user_b_fkey"
            columns: ["user_b"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matches_user_b_fkey"
            columns: ["user_b"]
            isOneToOne: false
            referencedRelation: "profiles_public"
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
          kind: string
          match_id: string
          sender: string
        }
        Insert: {
          body: string
          created_at?: string | null
          flagged?: boolean
          id?: string
          kind?: string
          match_id: string
          sender: string
        }
        Update: {
          body?: string
          created_at?: string | null
          flagged?: boolean
          id?: string
          kind?: string
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
          {
            foreignKeyName: "messages_sender_fkey"
            columns: ["sender"]
            isOneToOne: false
            referencedRelation: "profiles_public"
            referencedColumns: ["id"]
          },
        ]
      }
      photo_reviews: {
        Row: {
          ai_detail: string | null
          ai_verdict: string | null
          created_at: string
          path: string
          reviewed_at: string | null
          status: string
          user_id: string
        }
        Insert: {
          ai_detail?: string | null
          ai_verdict?: string | null
          created_at?: string
          path: string
          reviewed_at?: string | null
          status?: string
          user_id: string
        }
        Update: {
          ai_detail?: string | null
          ai_verdict?: string | null
          created_at?: string
          path?: string
          reviewed_at?: string | null
          status?: string
          user_id?: string
        }
        Relationships: []
      }
      profile_locations: {
        Row: {
          daily_count: number
          daily_date: string
          loc_lat: number
          loc_lng: number
          updated_at: string
          user_id: string
        }
        Insert: {
          daily_count?: number
          daily_date?: string
          loc_lat: number
          loc_lng: number
          updated_at?: string
          user_id: string
        }
        Update: {
          daily_count?: number
          daily_date?: string
          loc_lat?: number
          loc_lng?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "profile_locations_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profile_locations_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles_public"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          age_band: string | null
          anonymized_at: string | null
          available_times: string[] | null
          bio: string | null
          bio_features: Json | null
          birth_date: string
          children_living_together: boolean | null
          city: string | null
          cohabit_view: string | null
          created_at: string | null
          email_bounced: boolean
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
          prior_report_count: number
          region_block: string | null
          single_cert_verified: boolean
          status: string
          subscription_active: boolean
          understands_children: boolean
          understands_remarriage: boolean
          value_tags: string[]
          voice_profile_url: string | null
          withdrawn_at: string | null
        }
        Insert: {
          age_band?: string | null
          anonymized_at?: string | null
          available_times?: string[] | null
          bio?: string | null
          bio_features?: Json | null
          birth_date: string
          children_living_together?: boolean | null
          city?: string | null
          cohabit_view?: string | null
          created_at?: string | null
          email_bounced?: boolean
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
          prior_report_count?: number
          region_block?: string | null
          single_cert_verified?: boolean
          status?: string
          subscription_active?: boolean
          understands_children?: boolean
          understands_remarriage?: boolean
          value_tags?: string[]
          voice_profile_url?: string | null
          withdrawn_at?: string | null
        }
        Update: {
          age_band?: string | null
          anonymized_at?: string | null
          available_times?: string[] | null
          bio?: string | null
          bio_features?: Json | null
          birth_date?: string
          children_living_together?: boolean | null
          city?: string | null
          cohabit_view?: string | null
          created_at?: string | null
          email_bounced?: boolean
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
          prior_report_count?: number
          region_block?: string | null
          single_cert_verified?: boolean
          status?: string
          subscription_active?: boolean
          understands_children?: boolean
          understands_remarriage?: boolean
          value_tags?: string[]
          voice_profile_url?: string | null
          withdrawn_at?: string | null
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
            foreignKeyName: "reports_reported_fkey"
            columns: ["reported"]
            isOneToOne: false
            referencedRelation: "profiles_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reports_reporter_fkey"
            columns: ["reporter"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reports_reporter_fkey"
            columns: ["reporter"]
            isOneToOne: false
            referencedRelation: "profiles_public"
            referencedColumns: ["id"]
          },
        ]
      }
      stripe_events: {
        Row: {
          id: string
          received_at: string
          type: string
        }
        Insert: {
          id: string
          received_at?: string
          type: string
        }
        Update: {
          id?: string
          received_at?: string
          type?: string
        }
        Relationships: []
      }
      subscriptions: {
        Row: {
          cancel_at_period_end: boolean
          created_at: string
          current_period_end: string | null
          plan: string
          status: string
          stripe_customer_id: string
          stripe_subscription_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          cancel_at_period_end?: boolean
          created_at?: string
          current_period_end?: string | null
          plan: string
          status?: string
          stripe_customer_id: string
          stripe_subscription_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          cancel_at_period_end?: boolean
          created_at?: string
          current_period_end?: string | null
          plan?: string
          status?: string
          stripe_customer_id?: string
          stripe_subscription_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscriptions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscriptions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles_public"
            referencedColumns: ["id"]
          },
        ]
      }
      user_events: {
        Row: {
          actor_id: string | null
          event_type: string
          id: number
          match_id: string | null
          occurred_at: string
          props: Json
          target_user_id: string | null
        }
        Insert: {
          actor_id?: string | null
          event_type: string
          id?: number
          match_id?: string | null
          occurred_at?: string
          props?: Json
          target_user_id?: string | null
        }
        Update: {
          actor_id?: string | null
          event_type?: string
          id?: number
          match_id?: string | null
          occurred_at?: string
          props?: Json
          target_user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "user_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_events_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_events_target_user_id_fkey"
            columns: ["target_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_events_target_user_id_fkey"
            columns: ["target_user_id"]
            isOneToOne: false
            referencedRelation: "profiles_public"
            referencedColumns: ["id"]
          },
        ]
      }
      value_tag_master: {
        Row: {
          active: boolean
          category: string
          id: string
          label: string
          sort_order: number
        }
        Insert: {
          active?: boolean
          category: string
          id: string
          label: string
          sort_order: number
        }
        Update: {
          active?: boolean
          category?: string
          id?: string
          label?: string
          sort_order?: number
        }
        Relationships: []
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
          {
            foreignKeyName: "verifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles_public"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      profiles_public: {
        Row: {
          age: number | null
          available_times: string[] | null
          bio: string | null
          city: string | null
          cohabit_view: string | null
          created_at: string | null
          gender: string | null
          id: string | null
          income_verified: boolean | null
          is_verified: boolean | null
          marital_history: string | null
          marriage_intent: string | null
          money_view: string | null
          nickname: string | null
          photo_urls: string[] | null
          prefecture: string | null
          single_cert_verified: boolean | null
          status: string | null
          value_tags: string[] | null
        }
        Insert: {
          age?: never
          available_times?: string[] | null
          bio?: string | null
          city?: string | null
          cohabit_view?: string | null
          created_at?: string | null
          gender?: string | null
          id?: string | null
          income_verified?: boolean | null
          is_verified?: boolean | null
          marital_history?: string | null
          marriage_intent?: string | null
          money_view?: string | null
          nickname?: string | null
          photo_urls?: never
          prefecture?: string | null
          single_cert_verified?: boolean | null
          status?: string | null
          value_tags?: string[] | null
        }
        Update: {
          age?: never
          available_times?: string[] | null
          bio?: string | null
          city?: string | null
          cohabit_view?: string | null
          created_at?: string | null
          gender?: string | null
          id?: string | null
          income_verified?: boolean | null
          is_verified?: boolean | null
          marital_history?: string | null
          marriage_intent?: string | null
          money_view?: string | null
          nickname?: string | null
          photo_urls?: never
          prefecture?: string | null
          single_cert_verified?: boolean | null
          status?: string | null
          value_tags?: string[] | null
        }
        Relationships: []
      }
    }
    Functions: {
      _age_band: { Args: { p_birth: string }; Returns: string }
      _bio_features: { Args: { p_bio: string }; Returns: Json }
      _date_get_match: {
        Args: { p_match_id: string }
        Returns: {
          call_unlocked: boolean | null
          created_at: string | null
          id: string
          message_count: number
          user_a: string
          user_b: string
        }
        SetofOptions: {
          from: "*"
          to: "matches"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      _distance_km: {
        Args: { lat1: number; lat2: number; lng1: number; lng2: number }
        Returns: number
      }
      _email_hash: { Args: { p_email: string }; Returns: string }
      _email_hash_of: { Args: { p_user: string }; Returns: string }
      _log_event: {
        Args: {
          p_actor: string
          p_match: string
          p_props: Json
          p_target: string
          p_type: string
        }
        Returns: undefined
      }
      _record_withdrawal: {
        Args: { p_banned: boolean; p_reason: string; p_user: string }
        Returns: undefined
      }
      _region_block: { Args: { p_pref: string }; Returns: string }
      _snap_lat: { Args: { p_lat: number }; Returns: number }
      _snap_lng: { Args: { p_lng: number }; Returns: number }
      anonymize_profile: { Args: { p_user: string }; Returns: undefined }
      ban_account: {
        Args: { p_reason: string; p_user: string }
        Returns: undefined
      }
      can_caller_message: { Args: never; Returns: boolean }
      cancel_date: { Args: { p_match_id: string }; Returns: Json }
      compute_daily_stats: { Args: { p_date: string }; Returns: undefined }
      expire_stale_subscriptions: { Args: never; Returns: number }
      get_approved_photo_paths: {
        Args: { p_paths: string[] }
        Returns: {
          path: string
        }[]
      }
      get_date_status: { Args: { p_match_id: string }; Returns: Json }
      get_pending_file_deletions: {
        Args: never
        Returns: {
          bucket_id: string
          path: string
        }[]
      }
      get_profile_distances: {
        Args: { p_user_ids: string[] }
        Returns: {
          distance_km: number
          user_id: string
        }[]
      }
      get_suppression_list: {
        Args: never
        Returns: {
          email_hash: string
        }[]
      }
      is_blocked_between: { Args: { a: string; b: string }; Returns: boolean }
      is_caller_active: { Args: never; Returns: boolean }
      is_match_blocked: { Args: { target_match: string }; Returns: boolean }
      is_match_participant: { Args: { target_match: string }; Returns: boolean }
      is_photo_approved: { Args: { p_path: string }; Returns: boolean }
      is_photo_visible_to: { Args: { p_path: string }; Returns: boolean }
      is_subscription_active: { Args: { p_user: string }; Returns: boolean }
      log_user_event: {
        Args: {
          p_event_type: string
          p_props?: Json
          p_target_user_id?: string
        }
        Returns: undefined
      }
      mark_file_deleted: {
        Args: { p_bucket: string; p_path: string }
        Returns: undefined
      }
      propose_date_slot: {
        Args: { p_area: string; p_match_id: string; p_slot: Json }
        Returns: Json
      }
      register_photo_for_review: {
        Args: { p_path: string }
        Returns: undefined
      }
      respond_date_slot: {
        Args: { p_accept: boolean; p_match_id: string }
        Returns: Json
      }
      review_verification:
        | {
            Args: { approve: boolean; reason?: string; verification_id: string }
            Returns: undefined
          }
        | {
            Args: {
              approve: boolean
              p_reviewer?: string
              reason?: string
              verification_id: string
            }
            Returns: undefined
          }
      run_retention_job: { Args: never; Returns: Json }
      set_date_intent: {
        Args: { p_intent: boolean; p_match_id: string }
        Returns: Json
      }
      set_my_location: {
        Args: { p_lat: number; p_lng: number }
        Returns: undefined
      }
      submit_date_feedback: {
        Args: { p_feedback: string; p_match_id: string }
        Returns: Json
      }
      withdraw_account: { Args: never; Returns: Json }
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

